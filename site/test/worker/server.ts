import { FetchInterceptor } from "@mswjs/interceptors/fetch";
import { defineNetwork, InterceptorSource } from "msw/experimental";

// Shared MSW network for the worker project. Tests register per-case handlers
// with `server.use(...)`; lanes keep their handler factories in their own
// files under test/worker/<lane>/. The lifecycle and the guard live in msw.ts.
//
// Fetch only, by design: the Worker talks to the world through fetch() and
// nothing else. msw/node's setupServer also loads the ClientRequest
// interceptor, whose HTTP parser reads llhttp.wasm from disk at import, and
// workerd has no such file (#614). `quiet` matches setupServer: no per-request
// log, which would read every mocked body as text.
export const server = defineNetwork({
  sources: [new InterceptorSource({ interceptors: [new FetchInterceptor()] })],
  context: { quiet: true },
});
