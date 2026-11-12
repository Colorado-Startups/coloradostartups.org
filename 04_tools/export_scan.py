#!/usr/bin/env python3
"""export_scan.py: scan an exported public tree for what must never go public.

Runs over the folder export_public.py --out wrote (open-source plan, #552).
Secret scanners (gitleaks, trufflehog, secretlint) run beside it; this file
holds the checks they do not: personal data, private links and private terms.

  emails         every address, except public contact ones and test domains
  phones         North American phone numbers
  names          each name in --names FILE, outside the fixtures and the
                 public team pages
  profiles       linkedin.com/in/ profile links, outside the public team pages
  keys           token and key formats (GitHub, AWS, Slack, Stripe, Anthropic,
                 OpenAI, PEM private keys)
  private-links  links to --private-repos, claude.ai artifacts, Google Docs and
                 Drive, home folder paths, session ids
  private-terms  every regex in --private-rules (cs_site_rules.private.json)
  image-metadata images that carry EXIF, or an EXIF GPS block

--names, --private-repos and --private-rules are required: without them the
scan exits 3, unless --public-checks-only says the caller has no private
inputs (CI in a public tree), and the summary marks those checks as skipped.

The private inputs (names, the private repo list, the private rules) come in
at run time from the archive repo and are never written into the export.
Findings print as file:line and the check; key matches are redacted.

Usage:
  python3 04_tools/export_scan.py DIR [--names FILE] [--private-repos FILE]
                                      [--private-rules FILE] [--quiet]
  python3 04_tools/export_scan.py DIR --public-checks-only
  python3 04_tools/export_scan.py --self-test
Exit: 0 clean, 1 a finding, 2 usage error, 3 could not check.
"""

import argparse
import collections
import contextlib
import io
import fnmatch
import json
import os
import re
import shutil
import sys
import tempfile

# No __pycache__ in the repo: these tools run from hooks on every commit.
sys.dont_write_bytecode = True

EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_INFRA = 0, 1, 2, 3
MAX_BYTES = 4 * 1024 * 1024

# Public contact addresses the live site already shows (site/src/components/info/links.ts, SECURITY.md).
# forms@email.coloradostartups.org is the org's form sender (site/wrangler.jsonc).
PUBLIC_EMAILS = {"info@coloradostartups.org", "paul@coloradostartups.org", "forms@email.coloradostartups.org", "git@github.com"}
# Fake test domains, plus Google Calendar ids, which the live /event-calendar/ page embeds.
TEST_DOMAINS = re.compile(r"(?:^|\.)(?:example(?:\.(?:org|com|net))?|invalid|test|localhost|domain\.tld|b\.co|acme\.com|www\.linkedin\.com|group\.calendar\.google\.com)$", re.I)
FILE_TLDS = {"png", "jpg", "jpeg", "webp", "svg", "gif", "avif", "js", "mjs", "ts", "css", "json", "md", "html"}
# Where a team member's name and profile link may appear: the fixtures and the public team pages.
TEAM_PAGES = ("data/fixtures/", "data/team/", "site/src/pages/team/", "site/src/components/team/")

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,}))\b")
PHONE_RE = re.compile(r"(?<![\d.])(?:\+1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-][2-9]\d{2}[\s.-]\d{4}(?!\d)")
PROFILE_RE = re.compile(r"linkedin\.com/in/([A-Za-z0-9_%-]+)", re.I)
# Placeholder profile slugs the tests and form hints use.
FAKE_SLUGS = {"x", "test", "test-applicant", "someone", "some", "name", "your-name"}
# 555-0100 to 555-0199 is reserved for fiction (NANPA).
FICTION_PHONE = re.compile(r"555[\s.-]01\d\d$")
ALLOW_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "export_scan_allow.json")
KEY_RES = [
    ("github-token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})")),
    ("aws-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("slack-token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("stripe-key", re.compile(r"\b[sr]k_live_[A-Za-z0-9]{16,}")),
    ("anthropic-key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}")),
    ("openai-key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9]{32,}")),
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
]
LINK_RES = [
    ("claude-artifact", re.compile(r"claude\.ai/(?:public/)?artifacts?/|claude\.ai/code/artifact", re.I)),
    ("google-doc", re.compile(r"docs\.google\.com/(?:spreadsheets|document|presentation|forms)/d/|drive\.google\.com/", re.I)),
    ("home-path", re.compile(r"/Users/(?!someone\b)[A-Za-z0-9._-]+|/home/(?!someone\b|runner\b)[A-Za-z0-9._-]+"
                             r"|-Users-(?!someone-)[A-Za-z0-9._]+-|~/(?:Developer|Claude|Documents|Library|Compute)\b")),
    ("session-id", re.compile(r"\blocal_[0-9a-f]{8}-[0-9a-f]{4}-")),
]


class InfraError(Exception):
    """Could not check. Never reported as clean."""


def read_lines_file(path):
    """The file's non-blank, non-comment lines. A file named but empty could
    not feed its check, so it is could-not-check, never a pass (#678)."""
    if not path:
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            lines = [l.strip() for l in fh if l.strip() and not l.startswith("#")]
    except OSError as exc:
        raise InfraError("cannot read %s (%s)" % (path, exc))
    if not lines:
        raise InfraError("%s holds no entries" % path)
    return lines


def private_term_res(path):
    if not path:
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            rules = json.load(fh)["rules"]
        terms = [(r["id"], re.compile(r["regex"], 0 if r.get("case_sensitive") else re.I)) for r in rules]
    except (OSError, ValueError, KeyError, TypeError, re.error) as exc:
        raise InfraError("cannot load the private rules %s (%s)" % (path, exc))
    if not terms:
        raise InfraError("the private rules %s hold no rules" % path)
    return terms


IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".avif")

# XMP the art pipeline writes on purpose: the IPTC fields that disclose AI art,
# and the site's own art namespace (seed, source, model license). A packet of
# only these is provenance, not a leak (#691). Namespaces go by URI, since a
# packet picks its own prefixes, and each lists its fields by name (#795).
PROVENANCE_XMP = {
    "http://iptc.org/std/Iptc4xmpExt/2008-02-29/": {
        "DigitalSourceType", "AISystemUsed", "AISystemVersionUsed", "AIPromptInformation"},
    "https://coloradostartups.org/ns/art/1.0/": {
        "Seed", "Source", "ModelLicense", "ModelLicenseURL", "NegativePrompt"},
}
XMP_FRAME = {"adobe:ns:meta/", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"}
XMP_NAME = rb"([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)"


def provenance_only(packet, raw=None):
    """True when an XMP packet, from <x:xmpmeta to its close, holds only PROVENANCE_XMP properties.

    No reading that a crafted packet could steer (#795): no default namespace,
    which names no prefix to check; no prefix declared twice, where the last
    would win; and one packet, so a second one cannot hide behind the first.
    """
    end = packet.find(b"</x:xmpmeta>")
    if not packet.startswith(b"<x:xmpmeta") or end < 0:
        return False
    if (raw if raw is not None else packet).count(b"<x:xmpmeta") != 1:
        return False
    body = packet[:end]
    if re.search(rb"\sxmlns\s*=", body):
        return False
    declared = re.findall(rb'xmlns:([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"', body)
    if len({k for k, _ in declared}) != len(declared):
        return False
    uris = {k: v.decode("utf-8", "replace") for k, v in declared}
    names = set(re.findall(rb"</?" + XMP_NAME, body)) | set(re.findall(rb"\s" + XMP_NAME + rb"\s*=", body))
    for prefix, local in names:
        if prefix == b"xmlns":
            continue
        uri = uris.get(prefix)
        if uri in XMP_FRAME:
            continue
        if uri not in PROVENANCE_XMP:
            return False
        if local.decode() not in PROVENANCE_XMP[uri]:
            return False
    return True


def image_metadata(raw):
    """'gps', 'exif' or 'xmp' when an image carries that metadata, else None.

    GPS is the EXIF GPS IFD tag (0x8825, either byte order) inside the EXIF
    block, or a GPS field in an XMP packet, which can carry it with no EXIF
    at all (#678). An XMP packet of art provenance alone is no finding (#691).
    """
    at = raw.find(b"Exif\x00\x00")
    if at < 0 and raw[:4] == b"RIFF":
        at = raw.find(b"EXIF")
    if at < 0 and raw[:8] == b"\x89PNG\r\n\x1a\n":
        at = raw.find(b"eXIf")
    xmp = raw.find(b"<x:xmpmeta")
    if xmp < 0:
        xmp = raw.find(b"http://ns.adobe.com/xap/1.0/")
    packet = raw[xmp:xmp + 262144] if xmp >= 0 else b""
    if any(f in packet for f in (b"GPSLatitude", b"GPSLongitude", b"GPSAltitude")):
        return "gps"
    if at >= 0:
        block = raw[at:at + 65536]
        return "gps" if b"\x88\x25" in block or b"\x25\x88" in block else "exif"
    return "xmp" if xmp >= 0 and not provenance_only(packet, raw) else None


def text_files(root, images=None):
    """Each text file as (rel, text); a file over MAX_BYTES as (rel, None).

    Only the root's .git is skipped: a .git or node_modules folder anywhere
    else in an export is content and gets read. Images go to images, a list
    of (rel, finding) for those that carry EXIF.
    """
    for base, dirs, files in os.walk(root):
        if base == root:
            dirs[:] = [d for d in dirs if d != ".git"]
        for name in sorted(files):
            full = os.path.join(base, name)
            rel = os.path.relpath(full, root)
            try:
                if os.path.getsize(full) > MAX_BYTES:
                    yield rel, None
                    continue
                with open(full, "rb") as fh:
                    raw = fh.read()
            except OSError as exc:
                raise InfraError("cannot read %s (%s)" % (rel, exc))
            if images is not None and name.lower().endswith(IMAGE_EXT):
                meta = image_metadata(raw)
                if meta:
                    images.append((rel, meta))
            if b"\0" in raw[:8192]:
                continue  # binary: images, fonts
            yield rel, raw.decode("utf-8", errors="replace")


def load_allow(path=ALLOW_FILE):
    """The allowances: each {check, glob, reason}, optional rule (a private-terms id) and match (a regex the
    finding's excerpt must hit). The .private.json beside the file adds those naming private rules; it exists
    only in the archive repo. Any malformed file is could-not-check, never a silent pass."""
    rows = []
    private = path.replace(".json", ".private.json")
    try:
        for f in [path] + ([private] if os.path.exists(private) else []):
            with open(f, encoding="utf-8") as fh:
                doc = json.load(fh)
            if not isinstance(doc, dict) or not isinstance(doc.get("allow"), list):
                raise ValueError("%s needs an allow list" % f)
            rows += doc["allow"]
        for r in rows:
            ok = isinstance(r, dict) and r.get("check") in CHECKS and isinstance(r.get("glob"), str) and r["glob"] \
                and isinstance(r.get("reason"), str) and r["reason"].strip()
            if not ok:
                raise ValueError("each allowance needs a known check, a glob and a reason: %r" % (r,))
            if r.get("match") is not None:
                re.compile(r["match"])
        return rows
    except (OSError, ValueError, KeyError, TypeError, AttributeError, re.error) as exc:
        raise InfraError("cannot read the allowances (%s)" % exc)


def allowed(finding, allow):
    """True when an allowance covers the finding: its check, its path, its rule id and its match, if named."""
    check, rel, _, excerpt = finding
    return any(a["check"] == check and fnmatch.fnmatch(rel, a["glob"])
               and (not a.get("rule") or excerpt.startswith(a["rule"] + " "))
               and (not a.get("match") or re.search(a["match"], excerpt)) for a in allow)


def scan(root, names=(), private_repos=(), terms=(), public_names=(), allow=()):
    """Findings as (check, rel, line_no, excerpt), and the count of files read."""
    shown = {n.lower() for n in public_names}
    name_res = [(n, re.compile(r"(?<![\w-])%s(?![\w-])" % re.escape(n), re.I)) for n in names if len(n) > 4 and n.lower() not in shown]
    repo_re = None
    if private_repos:
        repo_re = re.compile(r"github\.com/Colorado-Startups/(?:%s)(?![\w.-])" % "|".join(map(re.escape, private_repos)), re.I)
    findings, read, images = [], 0, []
    for rel, text in text_files(root, images):
        if text is None:
            findings.append(("could-not-read", rel, 0, "over %d bytes" % MAX_BYTES))
            continue
        read += 1
        team = rel.startswith(TEAM_PAGES)
        for no, line in enumerate(text.splitlines(), 1):
            for m in EMAIL_RE.finditer(line):
                addr, domain, tld = m.group(0), m.group(1), m.group(2).lower()
                if addr.lower() in PUBLIC_EMAILS or TEST_DOMAINS.search(domain) or tld in FILE_TLDS:
                    continue
                findings.append(("emails", rel, no, addr))
            for m in PHONE_RE.finditer(line):
                if not rel.endswith(".svg") and not FICTION_PHONE.search(m.group(0)):
                    findings.append(("phones", rel, no, m.group(0)))
            if not team:
                for name, rx in name_res:
                    if rx.search(line):
                        findings.append(("names", rel, no, name))
                for m in PROFILE_RE.finditer(line):
                    if m.group(1).lower() not in FAKE_SLUGS:
                        findings.append(("profiles", rel, no, m.group(0)))
            for kind, rx in KEY_RES:
                m = rx.search(line)
                if m:
                    findings.append(("keys", rel, no, "%s %s..." % (kind, m.group(0)[:6])))
            for kind, rx in LINK_RES:
                m = rx.search(line)
                if m:
                    findings.append(("private-links", rel, no, "%s %s" % (kind, m.group(0))))
            if repo_re:
                m = repo_re.search(line)
                if m:
                    findings.append(("private-links", rel, no, "private-repo %s" % m.group(0)))
            for rid, rx in terms:
                m = rx.search(line)
                if m:
                    findings.append(("private-terms", rel, no, "%s %r" % (rid, m.group(0)[:40])))
    findings += [("image-metadata", rel, 0, meta) for rel, meta in images]
    return [f for f in findings if not allowed(f, allow)], read


CHECKS = ["emails", "phones", "names", "profiles", "keys", "private-links", "private-terms", "image-metadata",
          "could-not-read"]


def report(findings, read, quiet=False, inputs=None):
    by = collections.OrderedDict((c, []) for c in CHECKS)
    for f in findings:
        by[f[0]].append(f)
    print("| Check | Findings | Files |")
    print("| --- | --- | --- |")
    for check, rows in by.items():
        if check == "could-not-read" and not rows:
            continue
        files = len(set(r[1] for r in rows))
        note = (inputs or {}).get(check)
        print("| %s | %d | %d%s |" % (check, len(rows), files, " (%s)" % note if note else ""))
    print("export_scan: %d text files read, %d findings" % (read, len(findings)))
    if not quiet:
        for check, rel, no, excerpt in findings:
            print("%s:%d: %s: %s" % (rel, no, check, excerpt))
    if any(f[0] == "could-not-read" for f in findings):
        return EXIT_INFRA
    return EXIT_FAIL if findings else EXIT_OK


# A packet as the art pipeline writes one; %s takes one more property.
PROVENANCE_SAMPLE = (
    b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    b'<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"'
    b' xmlns:cs="https://coloradostartups.org/ns/art/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">'
    b"<Iptc4xmpExt:DigitalSourceType>trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType>"
    b"<Iptc4xmpExt:AIPromptInformation>a dwarf, score: 7, x:y=1</Iptc4xmpExt:AIPromptInformation>"
    b"<cs:Seed>42</cs:Seed>%s</rdf:Description></rdf:RDF></x:xmpmeta>")


def self_test():
    wrong = []
    tmp = tempfile.mkdtemp(prefix="cs-export-scan-")
    try:
        fake_key = "gh" + "p_" + "A1b2C3d4" * 5  # built at run time, never a real key
        bad = {
            "site/src/pages/a.astro": "Write to someone.private@gmail.com or call (303) 555-2742.\n",
            "docs/b.md": "Thanks to Jane Sampleperson, linkedin.com/in/jane-sampleperson-123.\n",
            "c.txt": "token: %s\n" % fake_key,
            "d.md": "See https://github.com/Colorado-Startups/secret-repo and /Users/alice/x and local_1234abcd-12ab-\n",
            "h.md": "/home/alice/notes\n-Users-alice-Developer-site\n~/Developer/x\n~/Claude/x\n~/Documents/x\n~/Library/x\n~/Compute/x\n",
            "sub/node_modules/pkg/i.txt": "mail me at nested.person@gmail.com\n",
            "sub/.git/config": "url = https://github.com/Colorado-Startups/secret-repo\n",
            "e.md": "We never name the Zorblax fund.\n",
        }
        clean = {
            "data/fixtures/team/people.yaml": "- name: Jane Sampleperson\n",
            "site/src/pages/team/index.astro": "linkedin.com/in/jane-sampleperson-123\n",
            "f.md": "Email info@coloradostartups.org or test@example.org. See @2x.png, version 1.20.3.\n",
            "g.png": "\0binary Jane Sampleperson",
            # Fiction phones, fake profile slugs, form ids and an SVG's path data stay clean.
            "j.md": "Call (303) 555-0142. linkedin.com/in/someone. Mail a@b.co, x@domain.tld.\n",
            "k.svg": "<path d=\"M303 555 1234\"/>\n",
        }
        for rel, text in list(bad.items()) + list(clean.items()):
            os.makedirs(os.path.dirname(os.path.join(tmp, rel)) or tmp, exist_ok=True)
            with open(os.path.join(tmp, rel), "w", encoding="utf-8") as fh:
                fh.write(text)
        images = {"gps.jpg": b"\xff\xd8\xff\xe1\x00\x10Exif\x00\x00MM\x00*\x88\x25\x00\x00",
                  "exif.jpg": b"\xff\xd8\xff\xe1\x00\x10Exif\x00\x00MM\x00*\x01\x0f\x00\x00",
                  "xmp-gps.png": (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR iTXtXML:com.adobe.xmp <x:xmpmeta>"
                                  b"<rdf:Description exif:GPSLatitude=\"39,44.5N\"/></x:xmpmeta>"),
                  "clean.png": b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR",
                  # #691: the art's provenance packet is clean; one more property is not.
                  "provenance.webp": b"RIFF\x00\x00\x00\x00WEBPXMP " + PROVENANCE_SAMPLE % b"",
                  "xmp-other.webp": b"RIFF\x00\x00\x00\x00WEBPXMP " + PROVENANCE_SAMPLE % b"<xmp:CreatorTool>Phone 9</xmp:CreatorTool>",
                  # #795: what a crafted packet could use to pass as provenance.
                  "xmp-default-ns.webp": b"RIFF\x00\x00\x00\x00WEBPXMP " + PROVENANCE_SAMPLE % (
                      b'<CreatorTool xmlns="http://ns.adobe.com/xap/1.0/">Phone 9</CreatorTool>'),
                  "xmp-gps-like.webp": b"RIFF\x00\x00\x00\x00WEBPXMP " + PROVENANCE_SAMPLE % (
                      b"<cs:GPSDestLatitude>39,44.5N</cs:GPSDestLatitude>"),
                  "xmp-two-prefixes.webp": b"RIFF\x00\x00\x00\x00WEBPXMP " + PROVENANCE_SAMPLE.replace(
                      b'<rdf:Description rdf:about=""', b'<rdf:Description xmlns:cs="http://ns.adobe.com/exif/1.0/">'
                      b"<cs:Source>DSC_0001</cs:Source></rdf:Description><rdf:Description rdf:about=\"\"", 1) % b"",
                  "xmp-two-packets.webp": b"RIFF\x00\x00\x00\x00WEBPXMP " + PROVENANCE_SAMPLE % b"" + (
                      b' <x:xmpmeta xmlns:x="adobe:ns:meta/"><exif:Make xmlns:exif="http://ns.adobe.com/exif/1.0/">Phone</exif:Make></x:xmpmeta>')}
        for rel, raw in images.items():
            with open(os.path.join(tmp, rel), "wb") as fh:
                fh.write(raw)
        os.makedirs(os.path.join(tmp, ".git"))
        with open(os.path.join(tmp, ".git", "config"), "w", encoding="utf-8") as fh:
            fh.write("url = https://github.com/Colorado-Startups/secret-repo\n")
        terms = [("sample-fund", re.compile(r"\bzorblax\b", re.I))]
        findings, _ = scan(tmp, names=["Jane Sampleperson"], private_repos=["secret-repo"], terms=terms)
        got = collections.Counter(f[0] for f in findings)
        want = {"emails": 2, "phones": 1, "names": 1, "profiles": 1, "keys": 1, "private-links": 11,
                "private-terms": 1, "image-metadata": 8}
        if dict(got) != want:
            wrong.append("known-bad gave %s, want %s" % (dict(got), want))
        hit_files = set(f[1] for f in findings)
        stray = sorted(hit_files & (set(clean) | {"clean.png", "provenance.webp", ".git/config"}))
        if sorted(f[3] for f in findings if f[0] == "image-metadata") != ["exif", "gps", "gps"] + ["xmp"] * 5:
            wrong.append("image metadata gave %s, want exif, gps (EXIF), gps (XMP only) and five xmp (non-provenance)"
                         % [f[3] for f in findings if f[0] == "image-metadata"])
        # A private input named but empty is could-not-check, never a pass.
        empty = os.path.join(tmp, "empty.txt")
        open(empty, "w").close()
        rules = os.path.join(tmp, "rules.json")
        with open(rules, "w", encoding="utf-8") as fh:
            json.dump({"rules": []}, fh)
        names = os.path.join(tmp, "names.txt")
        with open(names, "w", encoding="utf-8") as fh:
            fh.write("Jane Sampleperson\n")
        for label, args in (("an empty --names", ["--names", empty, "--private-repos", names, "--private-rules", rules]),
                            ("an empty --private-repos", ["--names", names, "--private-repos", empty, "--private-rules", rules]),
                            ("--private-rules with no rules", ["--names", names, "--private-repos", names, "--private-rules", rules])):
            out = io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
                rc = main([tmp, "--quiet"] + args)
            if rc != EXIT_INFRA:
                wrong.append("%s gave exit %d, want 3" % (label, rc))
        if stray:
            wrong.append("known-clean files flagged: %s" % stray)
        if any(fake_key in f[3] for f in findings):
            wrong.append("a key match was printed unredacted")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    allowance_cases(wrong)
    for msg in wrong:
        print("self-test: %s" % msg)
    print("export_scan self-test: %s" % ("FAIL" if wrong else "PASS"))
    return EXIT_FAIL if wrong else EXIT_OK


def allowance_cases(wrong):
    """The skips' edges stay findings, and a malformed allowance file is could-not-check."""
    tmp = tempfile.mkdtemp(prefix="cs-export-allow-")
    try:
        with open(os.path.join(tmp, "a.md"), "w", encoding="utf-8") as fh:
            # Built at run time, so this file's own text holds none of them.
            fh.write("Call (303) 555-" + "0200. linkedin.com/in/" + "someone-real. Mail real.person@" + "google.com.\n")
        allow = [{"check": "emails", "glob": "a.md", "match": "@nowhere\\.invalid$", "reason": "a match that misses"}]
        got = sorted(c for c, *_ in scan(tmp, allow=allow)[0])
        if got != ["emails", "phones", "profiles"]:
            wrong.append("edges of the skips gave %s, want emails, phones and profiles" % got)
        hit = [{"check": "emails", "glob": "a.md", "match": "@google\\.com$", "reason": "a match that hits"}]
        if any(c == "emails" for c, *_ in scan(tmp, allow=hit)[0]):
            wrong.append("an allowance whose match hits still reported the finding")
        # A placeholder slug and a fiction phone are skipped; a 19-character id is not a calendar UID.
        with open(os.path.join(tmp, "b.md"), "w", encoding="utf-8") as fh:
            fh.write("Call (303) 555-" + "0142. linkedin.com/in/" + "someone.\n")
        if scan(tmp, allow=allow)[0] != [f for f in scan(tmp, allow=allow)[0] if f[1] != "b.md"]:
            wrong.append("a placeholder slug or a fiction phone was reported")
        uid = load_allow()[0]
        short = ("emails", "data/events/upcoming.json", 1, "a" * 19 + "@" + "google.com")
        if uid.get("glob") != "data/events/upcoming.json" or allowed(short, [uid]):
            wrong.append("the calendar UID allowance passed an address that is no UID")
        for bad in ('{"allow": "abc"}', '{"allow": ["x"]}', '[]', '{"allow": [{"check": "emails", "glob": "a"}]}',
                    '{"allow": [{"check": "emails", "glob": "a", "reason": "r", "match": "("}]}', "not json"):
            f = os.path.join(tmp, "bad.json")
            with open(f, "w", encoding="utf-8") as fh:
                fh.write(bad)
            try:
                load_allow(f)
                wrong.append("a malformed allowance file loaded: %s" % bad)
            except InfraError:
                pass
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        print("usage error: %s" % message, file=sys.stderr)
        self.print_usage(sys.stderr)
        sys.exit(EXIT_USAGE)


def main(argv=None):
    parser = _Parser(description="scan an exported public tree")
    parser.add_argument("dir", nargs="?", help="the exported tree")
    parser.add_argument("--names", help="file: one name per line to look for")
    parser.add_argument("--private-repos", help="file: one private repo name per line")
    parser.add_argument("--private-rules", help="cs_site_rules.private.json")
    parser.add_argument("--public-names", help="file: names the live site already shows, never reported")
    parser.add_argument("--quiet", action="store_true", help="the summary table only")
    parser.add_argument("--public-checks-only", action="store_true",
                        help="run without --names, --private-repos and --private-rules (CI in a public tree)")
    parser.add_argument("--self-test", action="store_true", help="known-bad and known-clean samples")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if not args.dir or not os.path.isdir(args.dir):
        parser.error("give the exported tree's folder")
    missing = [f for f, v in (("--names", args.names), ("--private-repos", args.private_repos),
                              ("--private-rules", args.private_rules)) if not v]
    if missing and not args.public_checks_only:
        print("could not check: %s missing; pass them, or --public-checks-only to run the public checks alone"
              % ", ".join(missing), file=sys.stderr)
        return EXIT_INFRA
    try:
        names = read_lines_file(args.names)
        repos = read_lines_file(args.private_repos)
        terms = private_term_res(args.private_rules)
        findings, read = scan(args.dir, names, repos, terms, read_lines_file(args.public_names), load_allow())
    except InfraError as exc:
        print("could not check: %s" % exc, file=sys.stderr)
        return EXIT_INFRA
    inputs = {"names": "%d names" % len(names) if names else "no --names: not checked",
              "private-terms": "%d rules" % len(terms) if terms else "no --private-rules: not checked"}
    if repos:
        inputs["private-links"] = "%d private repos" % len(repos)
    return report(findings, read, args.quiet, inputs)


if __name__ == "__main__":
    sys.exit(main())
