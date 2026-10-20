import { afterEach, describe, expect, it, vi } from 'vitest';

const render = vi.fn((..._args: unknown[]) => undefined);
const createRoot = vi.fn((..._args: unknown[]) => ({ render }));
vi.mock('react-dom/client', () => ({ createRoot: (...args: unknown[]) => createRoot(...args) }));

describe('application bootstrap', () => {
  afterEach(() => {
    document.body.replaceChildren();
    createRoot.mockClear();
    render.mockClear();
    vi.resetModules();
  });

  it('creates one React root and renders the actual App entry', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('../src/main');
    expect(createRoot).toHaveBeenCalledExactlyOnceWith(document.getElementById('root'));
    expect(render).toHaveBeenCalledTimes(1);
    const element = render.mock.calls[0]?.[0] as { type: { name: string } };
    expect(element.type.name).toBe('App');
  });

  it('fails clearly when the HTML root element is missing', async () => {
    await expect(import('../src/main')).rejects.toThrow('The application root element is missing.');
    expect(createRoot).not.toHaveBeenCalled();
  });
});
