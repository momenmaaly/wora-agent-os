import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeReview, buildActionReview } from './action-summary.js';

test('a review is derived from the tool and payload, never from a free-form sentence', () => {
  const review = buildActionReview({
    toolId: 'filesystem.write', toolDescription: 'Write a file in the workspace', risk: 'medium',
    toolInput: { path: 'reports/summary.md', bytes: 2_048, target: 'workspace' },
  });
  assert.match(review.target, /reports\/summary\.md/u);
  assert.match(review.consequences, /Write a file/u);
  assert.ok(review.resourceImpact.length > 0);
  assert.equal(review.summaryVersion, 'wora-review-v1');
  assert.equal(review.safe, true);
});

test('high-risk actions without a reviewable target or effect are refused', () => {
  assert.throws(() => assertSafeReview(buildActionReview({ toolId: 'unknown.tool', risk: 'high', toolInput: {} })), /refused/u);
  assert.throws(() => assertSafeReview(buildActionReview({ toolId: 'github.merge', risk: 'high', toolInput: { target: 'repo' } })), /refused/u);
  assert.doesNotThrow(() => assertSafeReview(buildActionReview({ toolId: 'github.merge', toolDescription: 'Merge a pull request', risk: 'high', toolInput: { target: 'owner/repo#1' } })));
});

test('the review target changes when the payload target changes', () => {
  const first = buildActionReview({ toolId: 'payment.charge', toolDescription: 'Charge a customer', risk: 'high', toolInput: { target: 'cus_1', amountUsd: 10 } });
  const second = buildActionReview({ toolId: 'payment.charge', toolDescription: 'Charge a customer', risk: 'high', toolInput: { target: 'cus_2', amountUsd: 10 } });
  assert.notEqual(first.target, second.target);
  assert.match(first.summary, /cus_1/u);
  assert.match(second.summary, /cus_2/u);
});
