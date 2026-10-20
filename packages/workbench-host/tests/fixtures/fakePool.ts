// SPDX-License-Identifier: Apache-2.0
/**
 * A fake render pool for the host tests: it serves the "built lab" on the port of its first argument
 * and answers `GET /__pool/build` with the token of `SCENITY_LABS_POOL_TOKEN`. Each `POST /__pool/next` makes a new
 * build, as a change of the sources does.
 */
const port = Number(process.argv[2]);
const token = process.env.SCENITY_LABS_POOL_TOKEN ?? "";
let build = 1;
Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/__pool/")) return new Response("built lab");
    if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response("no", { status: 401 });
    if (url.pathname === "/__pool/next") build += 1;
    return Response.json({ id: build });
  },
});
console.log(`fake pool up on ${String(port)}`);

// A module: its names do not meet the names of the other fixture scripts.
export {};
