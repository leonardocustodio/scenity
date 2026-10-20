// SPDX-License-Identifier: Apache-2.0
/**
 * A fake dev server for the host tests: it answers HTTP on the port of its first argument and starts a child
 * process, so a test can see that a stop ends the whole process group. It prints the PID of the child.
 */
const port = Number(process.argv[2]);
const child = Bun.spawn(["sleep", "60"], { stdio: ["ignore", "ignore", "ignore"] });
console.log(`fake child ${String(child.pid)}`);
Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("fake lab") });
console.log(`fake server up on ${String(port)}`);
