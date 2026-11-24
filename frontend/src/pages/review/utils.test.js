import assert from "node:assert/strict";
import test from "node:test";
import { inferAnswers } from "./utils.ts";

const questions = [
  { id: 1, question: "什么是闭包？" },
  { id: "question-2", question: "什么时候使用闭包？" },
];

test("matches question text and retains IDs in question order", () => {
  const transcript = [
    { role: "assistant", content: questions[1].question },
    { role: "user", content: "保存状态" },
    { role: "assistant", content: questions[0].question },
    { role: "user", content: "函数保留词法作用域" },
  ];
  assert.deepEqual(inferAnswers(questions, transcript), [
    { question_id: 1, answer: "函数保留词法作用域" },
    { question_id: "question-2", answer: "保存状态" },
  ]);
});

test("returns an empty answer for skipped and unmatched questions", () => {
  const transcript = [
    { role: "user", content: questions[1].question },
    { role: "assistant", content: questions[0].question },
    { role: "assistant", content: "换一个问题" },
    { role: "user", content: "这个回答不属于前面的题目" },
  ];
  assert.deepEqual(inferAnswers(questions, transcript), [
    { question_id: 1, answer: "" },
    { question_id: "question-2", answer: "" },
  ]);
});

test("returns no answers when either input is empty", () => {
  assert.deepEqual(inferAnswers([], [{ role: "user", content: "回答" }]), []);
  assert.deepEqual(inferAnswers(questions, []), []);
  assert.deepEqual(inferAnswers(), []);
});
