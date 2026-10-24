import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { renderPublicPage } from "./rendered-browser";

test("waits for delayed JavaScript content while keeping requests on the target origin", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/private-probe") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("private-resource-should-not-load");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html lang="en"><head><title>Initial title</title></head><body>
      <div id="app">Starting</div>
      <script>
        setTimeout(() => {
          document.querySelector("#app").innerHTML =
            '<h1>Rendered heading</h1><p>' + 'Rendered words '.repeat(40) + '</p>' +
            '<img src="/photo.jpg" alt="Rendered photo">';
        }, 1800);
        const probe = document.createElement("script");
        probe.src = "http://127.0.0.1:" + location.port + "/private-probe";
        document.body.appendChild(probe);
      </script>
    </body></html>`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const target = new URL(`http://example.com:${address.port}/`);
    const rendered = await renderPublicPage(target, { address: "127.0.0.1", family: 4 });
    assert.ok(rendered, "expected headless Chromium to render the local fixture");
    assert.match(rendered.html, /Rendered heading/);
    assert.match(rendered.html, /Rendered photo/);
    assert.match(rendered.html, /Rendered words/);
    assert.doesNotMatch(rendered.html, /private-resource-should-not-load/);
    assert.equal(new URL(rendered.finalUrl).origin, target.origin);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
