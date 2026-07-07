/**
 * GraphQL queries and mutations for GitHub review thread operations.
 * Used by GheClient to list and resolve PR review threads.
 */

export const LIST_REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        reviewThreads(first: 100, after: $cursor) {
          nodes {
            id
            isResolved
            comments(first: 1) {
              nodes { databaseId }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

export const RESOLVE_THREAD_MUTATION = `
  mutation($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread { id isResolved }
    }
  }
`;
