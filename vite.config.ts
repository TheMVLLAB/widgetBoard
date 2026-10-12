import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// In GitHub Actions this automatically targets /REPOSITORY/ on project Pages.
// A custom domain can set VITE_BASE_PATH=/ in the workflow.
const repository = process.env.GITHUB_REPOSITORY?.split('/').at(-1)
const isUserSite = repository?.endsWith('.github.io')
const base = process.env.VITE_BASE_PATH ?? (repository && !isUserSite ? `/${repository}/` : '/')

export default defineConfig({ plugins: [react()], base, test: { environment: 'node', include: ['src/**/*.test.ts'] } })
