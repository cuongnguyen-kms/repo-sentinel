-- CreateEnum
CREATE TYPE "PrState" AS ENUM ('OPEN', 'CLOSED', 'MERGED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'QUEUED', 'IN_PROGRESS', 'REVIEWED', 'UPDATED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiReviewStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PR_NEW', 'PR_MERGED', 'PR_CLOSED', 'REVIEW_OUTDATED', 'REVIEW_COMPLETED', 'REVIEW_FAILED', 'REVIEW_CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('NEW', 'READ');

-- CreateTable
CREATE TABLE "GheConnection" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GheConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchedRepo" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "pollingInterval" INTEGER NOT NULL DEFAULT 300,
    "lastPolledAt" TIMESTAMP(3),
    "lastPollStatus" TEXT,
    "etag" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "promptTemplate" TEXT,
    "systemPromptTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchedRepo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "ghePrId" INTEGER NOT NULL,
    "ghePrNodeId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "authorLogin" TEXT NOT NULL,
    "authorAvatar" TEXT,
    "state" "PrState" NOT NULL DEFAULT 'OPEN',
    "headRef" TEXT NOT NULL,
    "baseRef" TEXT NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "diffUrl" TEXT NOT NULL,
    "createdAtGhe" TIMESTAMP(3) NOT NULL,
    "updatedAtGhe" TIMESTAMP(3) NOT NULL,
    "mergedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "changedFiles" INTEGER NOT NULL DEFAULT 0,
    "headCommitSha" TEXT,
    "draft" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiReview" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT,
    "commitSha" TEXT NOT NULL DEFAULT 'unknown',
    "status" "AiReviewStatus" NOT NULL DEFAULT 'QUEUED',
    "command" TEXT NOT NULL,
    "output" TEXT,
    "report" TEXT,
    "reviewPhase" TEXT,
    "summary" TEXT,
    "score" DOUBLE PRECISION,
    "codeReviewJson" TEXT,
    "findingsCount" INTEGER,
    "diffContent" TEXT,
    "terminalLog" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostedFindingComment" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "githubCommentId" TEXT,
    "githubHtmlUrl" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedOnGithub" BOOLEAN NOT NULL DEFAULT false,
    "resolutionStatus" TEXT DEFAULT 'OPEN',
    "resolutionReason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByCommitSha" TEXT,
    "carriedFromReviewId" TEXT,

    CONSTRAINT "PostedFindingComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "message" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "banned" BOOLEAN,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "idToken" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGroupRole" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserGroupRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGroupMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "UserGroupMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchedRepo_connectionId_fullName_key" ON "WatchedRepo"("connectionId", "fullName");

-- CreateIndex
CREATE INDEX "PullRequest_repoId_reviewStatus_idx" ON "PullRequest"("repoId", "reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_repoId_ghePrId_key" ON "PullRequest"("repoId", "ghePrId");

-- CreateIndex
CREATE INDEX "AiReview_pullRequestId_idx" ON "AiReview"("pullRequestId");

-- CreateIndex
CREATE INDEX "AiReview_status_idx" ON "AiReview"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PostedFindingComment_reviewId_findingId_key" ON "PostedFindingComment"("reviewId", "findingId");

-- CreateIndex
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "UserGroup_name_key" ON "UserGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_resource_action_key" ON "Permission"("resource", "action");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserGroupRole_groupId_roleId_key" ON "UserGroupRole"("groupId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserGroupMembership_userId_groupId_key" ON "UserGroupMembership"("userId", "groupId");

-- AddForeignKey
ALTER TABLE "WatchedRepo" ADD CONSTRAINT "WatchedRepo_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GheConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "WatchedRepo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReview" ADD CONSTRAINT "AiReview_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostedFindingComment" ADD CONSTRAINT "PostedFindingComment_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "AiReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroupRole" ADD CONSTRAINT "UserGroupRole_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroupRole" ADD CONSTRAINT "UserGroupRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroupMembership" ADD CONSTRAINT "UserGroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroupMembership" ADD CONSTRAINT "UserGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
