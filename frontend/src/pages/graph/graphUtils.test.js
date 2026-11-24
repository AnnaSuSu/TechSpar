import assert from "node:assert/strict";
import test from "node:test";
import { buildNodeRecommendation, getLinkKey, matchesGraphFilters, matchesScoreFilter } from "./graphUtils.ts";

test("matches the score filter boundaries", () => {
  assert.equal(matchesScoreFilter({ score: 3.9 }, "all"), true);
  assert.equal(matchesScoreFilter({ score: 3.9 }, "weak"), true);
  assert.equal(matchesScoreFilter({ score: 4 }, "weak"), false);
  assert.equal(matchesScoreFilter({ score: 4 }, "mid"), true);
  assert.equal(matchesScoreFilter({ score: 7.9 }, "mid"), true);
  assert.equal(matchesScoreFilter({ score: 8 }, "mid"), false);
  assert.equal(matchesScoreFilter({ score: 8 }, "strong"), true);
  assert.equal(matchesScoreFilter({ score: 7.9 }, "strong"), false);
});

test("combines trimmed text search, score and exact focus area filters", () => {
  const node = { question: "Explain Event Loops", focus_area: "JavaScript", score: 5 };
  assert.equal(matchesGraphFilters(node, "  event loops ", "mid", "JavaScript"), true);
  assert.equal(matchesGraphFilters(node, "javascript", "mid", "all"), true);
  assert.equal(matchesGraphFilters(node, "event loops", "weak", "JavaScript"), false);
  assert.equal(matchesGraphFilters(node, "event loops", "mid", "Python"), false);
  assert.equal(matchesGraphFilters(node, "promise", "all", "all"), false);
  assert.equal(matchesGraphFilters({ question: "Promise", score: 8 }, "", "strong", "all"), true);
});

test("recommends an appropriate next action at each score boundary", () => {
  assert.match(buildNodeRecommendation({ score: 3.9 }), /最近一次复盘/);
  assert.match(buildNodeRecommendation({ score: 4 }), /1 分钟答案/);
  assert.match(buildNodeRecommendation({ score: 6 }), /反例、边界和工程取舍/);
  assert.match(buildNodeRecommendation({ score: 8 }), /知识迁移/);
});

test("uses the same link key in both directions", () => {
  assert.equal(getLinkKey(7, 2), "2-7");
  assert.equal(getLinkKey(2, 7), "2-7");
  assert.equal(getLinkKey("q2", "q1"), "q1-q2");
  assert.equal(getLinkKey("q1", "q2"), "q1-q2");
});
