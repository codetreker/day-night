import { fileURLToPath } from 'node:url';
import config from '../../../packages/daynight-web/vite.config';

const root = fileURLToPath(new URL('../../../', import.meta.url));

export default {
  ...config,
  root,
  cacheDir: `${root}.tmp/task-browsing-vite`,
  resolve: {
    alias: {
      react: `${root}packages/daynight-web/node_modules/react`,
      'react-dom': `${root}packages/daynight-web/node_modules/react-dom`,
    },
  },
};
