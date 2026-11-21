#!/usr/bin/env node
import path from 'node:path'
import { root, requireTsc, runNodeScript } from './lib/tools.mjs'

process.exit(runNodeScript(requireTsc(), ['-p', path.join(root, 'tsconfig.json'), '--noEmit']))
