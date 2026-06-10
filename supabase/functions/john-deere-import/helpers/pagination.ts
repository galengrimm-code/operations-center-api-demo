// supabase/functions/john-deere-import/helpers/pagination.ts
import { callJohnDeereUrl } from "../../_shared/john-deere.ts";

interface PagedResponse<T> {
  values?: T[];
  links?: Array<{ rel: string; uri: string }>;
}

export async function* paginate<T>(accessToken: string, initialUrl: string): AsyncGenerator<T> {
  let url: string | null = initialUrl;
  while (url) {
    const resp = await callJohnDeereUrl(accessToken, url);
    if (!resp.ok) break;
    const data = (await resp.json()) as PagedResponse<T>;
    for (const item of data.values ?? []) yield item;
    const next = (data.links ?? []).find((l) => l.rel === "nextPage");
    url = next?.uri ?? null;
  }
}
