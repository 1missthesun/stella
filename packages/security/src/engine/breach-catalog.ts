import { fetchJson } from "./pure.ts";

export type PublicBreach = {
  Name: string;
  Title: string;
  Domain: string;
  BreachDate: string;
  AddedDate: string;
  PwnCount: number;
  DataClasses: string[];
  IsVerified: boolean;
  IsSensitive: boolean;
  IsSpamList: boolean;
  IsFabricated: boolean;
  IsMalware?: boolean;
};

/** The public list of known breaches (Have I Been Pwned, free, no key, no personal data sent). */
export const breachCatalog = async (): Promise<PublicBreach[]> => fetchJson<PublicBreach[]>("https://haveibeenpwned.com/api/v3/breaches");
