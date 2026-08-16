/**
 * 规格确认门测试：
 * - 引擎级：approve 决策回路（拒绝+反馈重生 spec，上限后 fail）
 * - 注册表级：waitForApproval 挂起/落锤/超时自动确认/abort 解除
 */

import { describe, expect, it, vi } from 'vitest';
import { runSOP } from '../src/lib/agent/engine';
import { DEFAULT_SOP } from '../src/lib/agent/sop';
import type { Executors } from '../src/lib/agent';
import type { ClarifyOutput, GenerateOutput, SpecOutput, VerifyResult } from '../src/lib/schemas';
import {
  waitForApproval,
  resolveApproval,
  pendingProjectOf,
  cancelApproval,
} from '../src/services/pending-approvals';

const CLARIFY: ClarifyOutput = { status: 'ready', summary: '需求明确' };
const SPEC: SpecOutput = { requirements: ['r1'], constraints: [], userStories: [] };
const GENERATED: GenerateOutput = {
  files: [{ path: 'index.html', content: '<!DOCTYPE html><html></html>' }],
  notes: 'mock',
};
const VERIFY_OK: VerifyResult = { pass: true, stage: 'structure', errors: [] };

function makeExecutors(specFn: Executors['spec']) {
  const executors: Executors = {
    clarify: async () => CLARIFY,
    spec: specFn,
    generate: async () => GENERATED,
    verify: async () => VERIFY_OK,
    locate: async (input) => ({ intent: input, anchors: [] }),
    patch: async () => ({ patchText: '', notes: '' }),
  };
  return executors;
}

describe('approve 决策回路（引擎级）', () => {
  it('拒绝+反馈 → 带反馈重生 spec → 确认 → done', async () => {
    const specFn = vi.fn(async () => SPEC);
    let calls = 0;
    const approver = async () => {
      calls += 1;
      return calls === 1
        ? { approved: false, feedback: '不想要博客，要作品集' }
        : { approved: true };
    };
    const out = await runSOP('做一个博客', DEFAULT_SOP, makeExecutors(specFn), approver);
    expect(out.finalState).toBe('done');
    expect(specFn).toHaveBeenCalledTimes(2);
    // 第二次 spec 调用携带用户反馈
    expect(specFn.mock.calls[1][1]).toBe('不想要博客，要作品集');
  });

  it('纯拒绝（无反馈）→ 直接 fail spec_rejected，不重生', async () => {
    const specFn = vi.fn(async () => SPEC);
    const out = await runSOP('做一个博客', DEFAULT_SOP, makeExecutors(specFn), async () => ({
      approved: false,
    }));
    expect(out.finalState).toBe('fail');
    expect(out.reason).toBe('spec_rejected');
    expect(specFn).toHaveBeenCalledTimes(1);
  });

  it('重生次数用尽（2 次重生后第 3 次拒绝）→ fail', async () => {
    const specFn = vi.fn(async () => SPEC);
    const out = await runSOP('做一个博客', DEFAULT_SOP, makeExecutors(specFn), async () => ({
      approved: false,
      feedback: '还是不对',
    }));
    expect(out.finalState).toBe('fail');
    expect(out.reason).toBe('spec_rejected');
    expect(specFn).toHaveBeenCalledTimes(3); // 首次 + 2 次重生
  });

  it('不传 approver → 自动通过（向后兼容）', async () => {
    const out = await runSOP(
      '做一个博客',
      DEFAULT_SOP,
      makeExecutors(async () => SPEC),
    );
    expect(out.finalState).toBe('done');
  });
});

describe('pending-approvals 注册表', () => {
  it('挂起后由 resolveApproval 落锤', async () => {
    const p = waitForApproval('u1', 'proj-1', 60_000);
    expect(pendingProjectOf('u1')).toBe('proj-1');
    expect(resolveApproval('u1', { approved: true })).toBe(true);
    await expect(p).resolves.toEqual({ approved: true });
    expect(pendingProjectOf('u1')).toBeUndefined();
  });

  it('无挂起时 resolveApproval 返回 false', () => {
    expect(resolveApproval('nobody', { approved: true })).toBe(false);
  });

  it('超时自动确认', async () => {
    const p = waitForApproval('u2', null, 30);
    await expect(p).resolves.toEqual({ approved: true, auto: true });
  });

  it('abort 信号解除挂起（approved:false）', async () => {
    const controller = new AbortController();
    const p = waitForApproval('u3', null, 60_000, controller.signal);
    controller.abort();
    await expect(p).resolves.toEqual({ approved: false, auto: true });
  });

  it('同用户重复挂起：旧的被自动解除', async () => {
    const p1 = waitForApproval('u4', null, 60_000);
    const p2 = waitForApproval('u4', null, 60_000);
    await expect(p1).resolves.toEqual({ approved: true, auto: true });
    cancelApproval('u4', { approved: true });
    await expect(p2).resolves.toEqual({ approved: true });
  });
});
