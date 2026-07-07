-- AlterTable
ALTER TABLE "AiReview" ADD COLUMN "openCommentsSnapshot" TEXT;

-- AlterTable
ALTER TABLE "PostedFindingComment" ADD COLUMN "githubThreadResolved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PostedFindingComment" ADD COLUMN "githubThreadResolvedAt" TIMESTAMP(3);
ALTER TABLE "PostedFindingComment" ADD COLUMN "dismissedAt" TIMESTAMP(3);
ALTER TABLE "PostedFindingComment" ADD COLUMN "dismissedBy" TEXT;
ALTER TABLE "PostedFindingComment" ADD COLUMN "dismissalKeyword" TEXT;
ALTER TABLE "PostedFindingComment" ADD COLUMN "replyCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PostedFindingComment" ADD COLUMN "lastReplyAt" TIMESTAMP(3);
ALTER TABLE "PostedFindingComment" ADD COLUMN "lastReplyAuthor" TEXT;
ALTER TABLE "PostedFindingComment" ADD COLUMN "lastReplyBody" TEXT;
ALTER TABLE "PostedFindingComment" ADD COLUMN "repliesSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FindingReply" (
  "id" TEXT NOT NULL,
  "postedCommentId" TEXT NOT NULL,
  "githubCommentId" TEXT NOT NULL,
  "githubHtmlUrl" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "isDismissal" BOOLEAN NOT NULL DEFAULT false,
  "matchedKeyword" TEXT,
  "createdAtGithub" TIMESTAMP(3) NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FindingReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FindingReply_githubCommentId_key" ON "FindingReply"("githubCommentId");
CREATE INDEX "FindingReply_postedCommentId_idx" ON "FindingReply"("postedCommentId");

-- AddForeignKey
ALTER TABLE "FindingReply"
  ADD CONSTRAINT "FindingReply_postedCommentId_fkey"
  FOREIGN KEY ("postedCommentId") REFERENCES "PostedFindingComment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
