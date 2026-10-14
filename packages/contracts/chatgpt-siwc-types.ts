export type ChatGptProfileSummary = {
  id: string;
  label: string;
  clientId: string;
  email?: string;
  name?: string;
  active: boolean;
  status: "signed_in" | "signed_out" | "reauth_required";
  planUsage: boolean;
  updatedAt: number;
};

export type ChatGptProfilesState = {
  profiles: ChatGptProfileSummary[];
};
