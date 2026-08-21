export type IssueAccessTokenInput = {
  userId: string;
  refreshSessionId: string;
  issuedAt: Date;
  maximumExpiresAt: Date;
};

export type IssuedAccessToken = {
  token: string;
  expiresAt: Date;
};

export type VerifiedAccessToken = {
  userId: string;
  refreshSessionId: string;
};

export abstract class AccessTokenProvider {
  abstract issue(input: IssueAccessTokenInput): Promise<IssuedAccessToken>;
  abstract verify(token: string): Promise<VerifiedAccessToken | null>;
}
