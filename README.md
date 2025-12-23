# zod-cast

ZodCast is a &lt;10kb, provider-agnostic bridge between Zod and LLMs. Stop "vibe coding" prompts and start forcing strict, type-safe JSON. It automatically translates schemas into TS interfaces, manages "retry-on-fail" loops for validation errors, and streams partial JSON for instant UI updates. 100% Type-safe. Zero bloat.

## Install

```bash
npm i zod zod-cast
```

## Usage

```ts
import { z } from "zod";
import { createTunnel } from "zod-cast";

const UserSchema = z.object({
  name: z.string(),
  age: z.number().describe("Age in years"),
  interests: z.array(z.string())
});

const tunnel = createTunnel(UserSchema);

const user = await tunnel.run(async ({ injectSchema }) => {
  const response = await myLLMProvider.chat({
    messages: [
      {
        role: "user",
        content: injectSchema("Extract a user from this: 'John is 30'")
      }
    ]
  });

  return response.text;
});

console.log(user.name);
```

## Streaming

```ts
import { z } from "zod";
import { createJsonStreamValidator } from "zod-cast/stream";

const validator = createJsonStreamValidator(UserSchema);

for await (const chunk of myStreamingLLM()) {
  const res = validator.push(chunk);
  if (res.status === "valid") {
    console.log(res.data);
  }
}
```
