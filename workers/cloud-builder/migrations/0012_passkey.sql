-- Passkeys (src/auth/): the @better-auth/passkey plugin's table, in the
-- shape its migration compiler generates for the plugin schema. A passkey is
-- an additional sign-in method for the web shell; devices keep signing in
-- with their existing credentials either way.

create table "passkey" ("id" text not null primary key, "name" text, "publicKey" text not null, "userId" text not null references "user" ("id") on delete cascade, "credentialID" text not null, "counter" integer not null, "deviceType" text not null, "backedUp" integer not null, "transports" text, "createdAt" date, "aaguid" text);

create index "passkey_userId_idx" on "passkey" ("userId");

create index "passkey_credentialID_idx" on "passkey" ("credentialID");
