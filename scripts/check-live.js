import { FakeIpFetchProvider } from "../index.js";

const [url = "https://example.com", proxyUrl = "http://127.0.0.1:7897"] =
  process.argv.slice(2);
const provider = new FakeIpFetchProvider({ proxyUrl });
let fallbacks = 0;
const requestProxy = provider.requestProxy.bind(provider);
provider.requestProxy = (...args) => {
  fallbacks++;
  return requestProxy(...args);
};
try {
  const result = await provider.fetch({ url });
  console.log(
    JSON.stringify(
      {
        status: result.statusCode,
        characters: result.body.content.length,
        fakeIpFallbacks: fallbacks,
      },
      null,
      2,
    ),
  );
  if (result.statusCode < 200 || result.statusCode >= 300) process.exitCode = 1;
} finally {
  await provider.dispose();
}
