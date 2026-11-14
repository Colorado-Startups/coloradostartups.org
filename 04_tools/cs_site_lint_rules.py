"""The content lint's rules: the rules file, its private overlay, and voice_lint.

Split from cs_site_lint.py, which imports every name here and is the one
entry point; its docstring holds the rules' contract.
"""

import datetime
import importlib.util
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.dirname(HERE)
DEFAULT_RULES = os.path.join(HERE, "cs_site_rules.json")
DEFAULT_PRIVATE_RULES = os.path.join(HERE, "cs_site_rules.private.json")
PRIVATE_RULES_ENV = "CS_SITE_PRIVATE_RULES"
# While this marker sits beside the overlay (the archive repo), the overlay
# must load whole: a missing or short overlay is could-not-check (exit 3).
MARKER_NAME = ".private-overlay-required"
DEFAULT_MARKER = os.path.join(HERE, MARKER_NAME)
VOICE_LINT = os.path.join(HERE, "voice_lint.py")

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_USAGE = 2
EXIT_INFRA = 3

SEVERITIES = ("FAIL", "WARN", "off")
# File types --built can read; scope.built in the rules file picks among them.
BUILT_TYPES = (".html", ".json", ".txt")


class InfraError(Exception):
    """Could not verify. Never reported as a content violation."""


class UsageError(Exception):
    """Bad command line input."""


# --------------------------------------------------------------------------
# Rules file


def glob_to_regex(pattern):
    """Translate a path glob with ** into an anchored regex."""
    out = []
    i = 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("^" + "".join(out) + "$")


def glob_match(pattern, rel):
    return bool(glob_to_regex(pattern).match(rel))


def parse_date(text, what="date"):
    try:
        return datetime.datetime.strptime(str(text), "%Y-%m-%d").date()
    except ValueError:
        raise InfraError("bad %s %r (want YYYY-MM-DD)" % (what, text))


def check_severity(value, where):
    if value not in SEVERITIES:
        raise InfraError("%s: severity %r must be FAIL, WARN or off" % (where, value))
    return value


class Config(object):
    """The rules file, validated and compiled."""

    def __init__(self, data, path):
        self.path = path
        try:
            self._build(data)
        except InfraError:
            raise
        except (KeyError, TypeError, AttributeError, ValueError, re.error) as exc:
            raise InfraError("rules file %s is malformed (%s: %s)"
                             % (path, type(exc).__name__, exc))

    def _build(self, data):
        scope = data["scope"]
        self.content_globs = list(scope["content"])
        self.built_globs = list(scope["built"])
        # --built reads the file types scope.built names. A type with no
        # extractor is a rules-file error, never a silent skip.
        self.built_suffixes = tuple(sorted(set(os.path.splitext(g)[1] for g in self.built_globs)))
        unknown = [s or "(none)" for s in self.built_suffixes if s not in BUILT_TYPES]
        if unknown:
            raise InfraError("scope.built names file types the lint cannot read: %s (it reads %s)"
                             % (", ".join(unknown), ", ".join(BUILT_TYPES)))
        self.never_globs = list(scope.get("never", []))
        extract = data["extract"]
        self.skip_keys = set(k.lower() for k in extract["skip_keys"])
        self.html_skip_tags = set(t.lower() for t in extract["html_skip_tags"])
        self.vl_rules = dict(data["voice_lint"]["rules"])
        self.rules = []
        seen = set()
        for spec in data["rules"]:
            rid = spec["id"]
            if rid in seen:
                raise InfraError("duplicate rule id %r" % rid)
            seen.add(rid)
            check_severity(spec["severity"], rid)
            if "severity_built" in spec:
                check_severity(spec["severity_built"], rid + " severity_built")
            window = spec.get("window")
            if window is not None:
                keys = set(window)
                if len(keys) != 1 or not keys <= {"until", "through"}:
                    raise InfraError("rule %s: window needs exactly one of 'until' or 'through'" % rid)
                parse_date(list(window.values())[0], "window date in rule %s" % rid)
            if "after_expiry" in spec:
                if window is None:
                    raise InfraError("rule %s: after_expiry without a window" % rid)
                check_severity(spec["after_expiry"], rid + " after_expiry")
            for key in ("paths", "fields", "built_types", "built_skip_tags"):
                if key in spec and not (isinstance(spec[key], list)
                                        and all(isinstance(p, str) for p in spec[key])):
                    raise InfraError("rule %s: %s must be a list of strings" % (rid, key))
            unread = [t for t in spec.get("built_types", []) if t not in BUILT_TYPES]
            if unread:
                raise InfraError("rule %s: built_types names %s (the lint reads %s)"
                                 % (rid, ", ".join(unread), ", ".join(BUILT_TYPES)))
            flags = 0 if spec.get("case_sensitive") else re.IGNORECASE
            rule = dict(spec)
            rule["re"] = re.compile(spec["regex"], flags)
            rule["exempt_re"] = re.compile(spec["exempt_match"], flags) if "exempt_match" in spec else None
            rule["fields_set"] = set(f.lower() for f in spec.get("fields", []))
            self.rules.append(rule)

    def is_never(self, rel):
        return any(glob_match(g, rel) for g in self.never_globs)

    def in_content_scope(self, rel):
        if self.is_never(rel):
            return False
        return any(glob_match(g, rel) for g in self.content_globs)


def _read_json_object(path, what):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, UnicodeDecodeError) as exc:
        raise InfraError("cannot read %s %s (%s)" % (what, path, exc))
    except ValueError as exc:
        raise InfraError("%s %s is not valid JSON (%s)" % (what, path, exc))
    if not isinstance(data, dict):
        raise InfraError("%s %s must hold a JSON object" % (what, path))
    return data


def private_rules_path(env=None, default=None):
    """The private overlay's path, and whether the caller named it.

    A path named in CS_SITE_PRIVATE_RULES must exist; the variable set but
    empty is an error. The default path may be absent: that is the public
    repo, which runs on the public rules alone.
    """
    env = os.environ if env is None else env
    if PRIVATE_RULES_ENV in env:
        if not env[PRIVATE_RULES_ENV]:
            raise InfraError("%s is set but empty; unset it or name the overlay" % PRIVATE_RULES_ENV)
        return env[PRIVATE_RULES_ENV], True
    return default or DEFAULT_PRIVATE_RULES, False


def private_marker(overlay_path, named, marker=None):
    """The required-overlay marker as a dict, or None when there is none.

    It is looked for beside the lint (the archive repo) and, for a named
    overlay, beside that overlay.
    """
    places = [marker or DEFAULT_MARKER]
    if named:
        places.append(os.path.join(os.path.dirname(os.path.abspath(overlay_path)), MARKER_NAME))
    found = next((p for p in places if os.path.exists(p)), None)
    if found is None:
        return None
    data = _read_json_object(found, "private overlay marker")
    for key in ("min_rules", "min_shared_ids"):
        if not isinstance(data.get(key), int) or data[key] < 1:
            raise InfraError("private overlay marker %s needs a positive %s" % (found, key))
    req = data.get("required_ids", [])
    if not isinstance(req, list) or not all(isinstance(i, str) for i in req):
        raise InfraError("private overlay marker %s: required_ids must be a list of strings" % found)
    if not isinstance(data.get("expected_windows", {}), dict):
        raise InfraError("private overlay marker %s: expected_windows must be an object" % found)
    data["_path"] = found
    return data


def overlay_shortfall(overlay, mark):
    """What the overlay lacks against the marker, as text; empty when whole.

    Counts unique rule ids and unique shared ids, so copies of one rule never
    meet the floor, and names each required id that is missing (#667).
    One definition: contract_test.py C11 and termRuleIds() check the same.
    """
    ids = set(r.get("id") for r in overlay.get("rules", []) if isinstance(r, dict))
    shared = set(overlay.get("shared_ids", []))
    short = ["%d unique %s, want at least %d" % (n, what, mark[key])
             for what, n, key in (("rule ids", len(ids), "min_rules"), ("shared ids", len(shared), "min_shared_ids"))
             if n < mark[key]]
    missing = sorted(set(mark.get("required_ids", [])) - ids)
    if missing:
        short.append("required ids missing: %s" % ", ".join(missing))
    return short


def load_rules_data(path=None, env=None, default_private=None, marker=None, enforce=True):
    """The rules file with the private overlay merged in.

    Returns (data, overlay_path), where overlay_path is None when no overlay
    was found. Overlay rules join data["rules"] and its shared_ids join
    shared_from.ids. With the marker present the overlay must load with the
    marker's minimum counts, or InfraError; enforce=False lets
    contract_test.py C11 report that as a FAIL instead. data["private_marker"]
    holds the marker and data["private_windows"] its windows, for C7 and C11.
    One definition: the contract test calls this too.
    """
    data = dict(_read_json_object(path or DEFAULT_RULES, "rules file"))
    overlay_path, named = private_rules_path(env, default_private)
    if os.path.exists(overlay_path) and not os.path.isfile(overlay_path):
        raise InfraError("the private rules overlay %s is not a file" % overlay_path)
    mark = private_marker(overlay_path, named, marker)
    data["private_marker"] = mark
    data["private_windows"] = dict((mark or {}).get("expected_windows", {}))
    if not os.path.isfile(overlay_path):
        if named:
            raise InfraError("%s names %s, which does not exist" % (PRIVATE_RULES_ENV, overlay_path))
        if mark and enforce:
            raise InfraError("%s requires the private rules overlay, and %s is missing" % (mark["_path"], overlay_path))
        return data, None
    overlay = _read_json_object(overlay_path, "private rules file")
    if not isinstance(overlay.get("rules"), list) or not overlay["rules"]:
        raise InfraError("private rules file %s has no rules: an empty overlay is never meant" % overlay_path)
    if not isinstance(overlay.get("shared_ids", []), list):
        raise InfraError("private rules file %s: shared_ids must be a list" % overlay_path)
    if mark and enforce:
        short = overlay_shortfall(overlay, mark)
        if short:
            raise InfraError("private rules overlay %s is short of %s: %s" % (overlay_path, mark["_path"], "; ".join(short)))
    data["rules"] = list(data["rules"]) + overlay["rules"]
    shared = dict(data.get("shared_from") or {})
    shared["ids"] = list(shared.get("ids", [])) + list(overlay.get("shared_ids", []))
    if overlay.get("linkedin_rules_path"):
        shared["path"] = overlay["linkedin_rules_path"]
    data["shared_from"] = shared
    return data, overlay_path


def load_config(path=None, env=None, default_private=None, marker=None):
    data, overlay_path = load_rules_data(path, env, default_private, marker)
    cfg = Config(data, path or DEFAULT_RULES)
    cfg.private_path = overlay_path
    return cfg


def window_expired(window, today):
    if not window:
        return False
    if "until" in window:
        return today >= parse_date(window["until"])
    return today > parse_date(window["through"])


def effective_severity(rule, today, built=False):
    """Severity on this date and in this mode, after the rule's window. None means off.

    In --built mode a rule's severity_built, when set, replaces its severity:
    a page that ships is held harder than a draft (#808).
    """
    sev = rule.get("severity_built", rule["severity"]) if built else rule["severity"]
    if window_expired(rule.get("window"), today):
        sev = rule.get("after_expiry", "off")
    return None if sev == "off" else sev


def rule_applies_to(rule, rel, built):
    """Path filter. A rule without 'paths' runs everywhere in scope.

    In --built mode a path-limited rule runs only when it sets built: true,
    because the HTML path (site/dist/...) never matches a data/ glob. A rule
    with built_types reads only those built file types.
    """
    if built and rule.get("built_types") and not rel.endswith(tuple(rule["built_types"])):
        return False
    paths = rule.get("paths")
    if not paths:
        return True
    if built:
        return bool(rule.get("built"))
    return any(glob_match(p, rel) for p in paths)


def rule_matches(rule, text):
    """The rule's matches in text, less those its exempt_match covers whole.

    exempt_match keeps a shared regex the same as the LinkedIn file's while the
    site lets one form through: placeholder's bare "[1]" citation (#808 review).
    """
    exempt = rule.get("exempt_re")
    for m in rule["re"].finditer(text):
        if not (exempt and exempt.fullmatch(m.group(0).strip())):
            yield m


# --------------------------------------------------------------------------
# voice_lint


def load_voice_lint(cfg, path=VOICE_LINT):
    """Return ((module, rules), None), or (None, reason) when it cannot load."""
    if not os.path.isfile(path):
        return None, "voice_lint.py not found at %s; generic prose rules did not run" % path
    try:
        spec = importlib.util.spec_from_file_location("cs_site_voice_lint", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for name in ("lint_text", "load_rules_from_obj"):
            if not callable(getattr(mod, name, None)):
                return None, "voice_lint.py has no %s(); its API changed" % name
        clean = {k: v for k, v in cfg.vl_rules.items() if not k.startswith("_")}
        rules = mod.load_rules_from_obj(clean)
    except Exception as exc:  # any import or rules failure is infrastructure
        return None, "voice_lint.py could not load (%s: %s)" % (type(exc).__name__, exc)
    return (mod, rules), None
