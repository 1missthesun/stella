export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
  image?: string;
  favicon?: string;
};

export type WebSearchResult = {
  text: string;
  results: WebSearchHit[];
};

export type SearchCalls = {
  "search.web": {
    args: { query: string; category?: string };
    result: WebSearchResult;
  };
};
