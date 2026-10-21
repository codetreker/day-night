import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskPullRequests } from '../src/features/task-detail/TaskPullRequests';

const entries = (length: number) => Array.from({ length }, (_, index) => ({ title: `关联 ${index + 1}`, url: `https://example.com/pull/${index + 1}` }));
const shown = () => within(screen.getByRole('region', { name: '关联 PR' })).getAllByRole('listitem');
const titles = () => shown().map((item) => item.querySelector('.drawer-pr-title')?.textContent);

afterEach(cleanup);

describe('local PR pagination', () => {
  it('keeps up to 100 complete records in the existing presentation without pagination controls', () => {
    const pullRequests = entries(100);
    render(<TaskPullRequests pullRequests={pullRequests} />);
    expect(shown()).toHaveLength(100);
    expect(titles()).toEqual(pullRequests.map(({ title }) => title));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reaches every ordered record, including late duplicates and raw strings, with at most 100 mounted rows', async () => {
    const pullRequests = entries(205);
    pullRequests[100] = { ...pullRequests[0]! };
    pullRequests[200] = { title: '', url: '' };
    pullRequests[201] = { title: '  多行\n\t\0标题  ', url: '  arbitrary\0URL\n  ' };
    pullRequests[202] = { ...pullRequests[0]! };
    render(<TaskPullRequests pullRequests={pullRequests} />);
    const user = userEvent.setup();
    const selector = screen.getByRole('combobox', { name: '关联 PR 页码' });
    const previous = screen.getByRole('button', { name: '上一页' });
    const next = screen.getByRole('button', { name: '下一页' });
    expect(previous).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('第 1–100 项，共 205 项');
    const reached = [...titles()];
    await user.click(next);
    expect(next).toHaveFocus();
    expect(shown()).toHaveLength(100);
    expect(screen.getByRole('status')).toHaveTextContent('第 101–200 项，共 205 项');
    reached.push(...titles());
    await user.click(next);
    expect(selector).toHaveFocus();
    expect(next).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('第 201–205 项，共 205 项');
    expect(shown()).toHaveLength(5);
    reached.push(...titles());
    expect(reached).toEqual(pullRequests.map(({ title }) => title === '' ? '（空字符串）' : title));
    expect(shown()[1]?.querySelector('.drawer-pr-value')?.textContent).toBe(pullRequests[201]!.url);
    await user.click(previous);
    expect(previous).toHaveFocus();
    await user.click(previous);
    expect(previous).toBeDisabled();
    expect(selector).toHaveFocus();
    await user.selectOptions(selector, '2');
    expect(selector).toHaveFocus();
    expect(shown()).toHaveLength(5);
    expect(pullRequests).toHaveLength(205);
  });

  it('resets a replaced collection before commit and preserves or relocates focus to current controls', async () => {
    const original = entries(205);
    const view = render(<TaskPullRequests pullRequests={original} />);
    const user = userEvent.setup();
    const selector = screen.getByRole('combobox', { name: '关联 PR 页码' });
    await user.selectOptions(selector, '2');
    const replacement = entries(101).map((entry) => ({ ...entry, title: `新${entry.title}` }));
    view.rerender(<TaskPullRequests pullRequests={replacement} />);
    expect(selector).toHaveValue('0');
    expect(selector).toHaveFocus();
    expect(titles()).toEqual(replacement.slice(0, 100).map(({ title }) => title));
    view.rerender(<TaskPullRequests pullRequests={replacement.slice(0, 1)} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('heading', { name: '关联 PR · 1' })).toHaveFocus();
    expect(titles()).toEqual([replacement[0]!.title]);
  });

  it('restores a removed row link to page selection without stealing focus from another region', async () => {
    const original = entries(205);
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      const view = render(<TaskPullRequests pullRequests={original} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByRole('combobox'), '2');
      within(shown()[0]!).getByRole('link').focus();
      view.rerender(<TaskPullRequests pullRequests={entries(101)} />);
      expect(screen.getByRole('combobox')).toHaveFocus();
      outside.focus();
      view.rerender(<TaskPullRequests pullRequests={[]} />);
      expect(outside).toHaveFocus();
      expect(screen.getByText('暂无关联 PR')).toBeVisible();
    } finally { outside.remove(); }
  });
});
