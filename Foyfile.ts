import { promises as fsPromises } from 'fs'
import * as NodePath from 'path'
import { task, desc, option, fs, setGlobalOptions } from 'foy'

async function syncVditorAssets() {
  const sourceDir = NodePath.resolve('media-src/node_modules/vditor/dist')
  const targetDir = NodePath.resolve('media/vditor/dist')

  await fsPromises.rm(targetDir, { recursive: true, force: true })
  await fsPromises.mkdir(targetDir, { recursive: true })
  await Promise.all([
    fsPromises.cp(NodePath.join(sourceDir, 'js'), NodePath.join(targetDir, 'js'), {
      recursive: true,
    }),
    fsPromises.cp(NodePath.join(sourceDir, 'css'), NodePath.join(targetDir, 'css'), {
      recursive: true,
    }),
    fsPromises.cp(
      NodePath.join(sourceDir, 'images'),
      NodePath.join(targetDir, 'images'),
      { recursive: true }
    ),
    fsPromises.copyFile(
      NodePath.join(sourceDir, 'index.css'),
      NodePath.join(targetDir, 'index.css')
    ),
  ])
  // Drop unused MathJax (~6.5 MB, the largest renderer asset). Vditor defaults
  // to KaTeX (`preview.math.engine`) and never fetches MathJax at runtime — the
  // webview sets no engine. If a `MathJax` engine option is ever introduced,
  // REMOVE this exclusion. See tasks/40-drop-unused-mathjax.md.
  await fsPromises.rm(NodePath.join(targetDir, 'js', 'mathjax'), {
    recursive: true,
    force: true,
  })
  await removeMacMetadata(targetDir)
}

async function removeMacMetadata(dirPath: string) {
  const entries = await fsPromises.readdir(dirPath, { withFileTypes: true })

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = NodePath.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        await removeMacMetadata(entryPath)
        return
      }
      if (entry.name === '.DS_Store') {
        await fsPromises.rm(entryPath, { force: true })
      }
    })
  )
}

setGlobalOptions({ loading: false, strict: true })
task('watch', async (ctx) => {
  // Your build tasks
  await syncVditorAssets()
  await Promise.all([
    ctx.exec('tsc -w -p ./'),
    ctx.cd('./media-src').exec('npm run start'),
  ])
})

task('build', async (ctx) => {
  await syncVditorAssets()
  await Promise.all([
    ctx.exec('tsc -p ./'),
    ctx.cd('./media-src').exec('npm run build'),
  ])
  await ctx.exec('git add -A')
})
