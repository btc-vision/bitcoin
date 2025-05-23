// This file is required to run mocha tests on the TS files directly

import { register } from 'ts-node';

register({
    project: 'test/tsconfig.json',
});
