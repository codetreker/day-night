const mode = process.argv[2];
const response = (status, body) => `HTTP/2.0 ${status}\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}`;
if (mode === "credential-success") process.stdout.write("fake-native-child-token\n");
else if (mode === "credential-environment") process.stdout.write(response("200 OK", { id: process.env.GH_ENTERPRISE_TOKEN === "fake-native-child-token" ? 42 : 0 }));
else if (mode === "success") process.stdout.write(response("200 OK", { id: 42 }));
else if (mode === "rate-limit-html") {
  process.stdout.write("HTTP/2.0 429 Too Many Requests\nContent-Type: text/html\r\nRetry-After: 3600\r\n\r\n<html>Too many requests</html>");
  process.stderr.write("gh: Too Many Requests (HTTP 429)\n");
  process.exitCode = 1;
} else if (mode === "not-found") {
  process.stdout.write(response("404 Not Found", { message: "Not Found" }));
  process.stderr.write("gh: Not Found (HTTP 404)\n");
  process.exitCode = 1;
} else if (mode === "non-http") {
  process.stdout.write("not an HTTP response");
  process.exitCode = 1;
} else if (mode === "failed-success") {
  process.stdout.write(response("200 OK", { id: 42 }));
  process.exitCode = 1;
} else if (mode === "overflow") {
  process.stdout.write(response("200 OK", { id: 42 }));
  process.stdout.write(" ".repeat(100_000));
} else if (mode === "wait") {
  process.stdout.write(response("200 OK", { id: 42 }));
  setTimeout(() => {}, 60_000);
} else throw new Error(`Unknown fixture mode: ${mode}`);
