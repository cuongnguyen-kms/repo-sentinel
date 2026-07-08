CREATE TABLE "AtlassianConnection" (
  "id" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "apiToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AtlassianConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AtlassianConnection_hostname_key" ON "AtlassianConnection"("hostname");

CREATE TABLE "JiraChecklist" (
  "ticketKey" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JiraChecklist_pkey" PRIMARY KEY ("ticketKey")
);

ALTER TABLE "PullRequest" ADD COLUMN "jiraTicketKeyOverride" TEXT;
