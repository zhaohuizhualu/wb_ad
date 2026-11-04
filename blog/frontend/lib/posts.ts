import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const POSTS_DIR = path.resolve(process.cwd(), '..', 'content', 'posts')

function stringifyDate(d: unknown): string {
  if (!d) return ''
  if (typeof d === 'string') return d.split('T')[0]
  if (d instanceof Date) return d.toISOString().split('T')[0]
  return String(d).split('T')[0]
}

export interface PostMeta {
  slug: string
  title: string
  date: string
  excerpt?: string
  tags?: string[]
  cover?: string
}

export interface Post extends PostMeta {
  content: string
}

export function getAllPosts(): PostMeta[] {
  try {
    if (!fs.existsSync(POSTS_DIR)) return []

    const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'))

    const posts = files.map((filename) => {
      const slug = filename.replace(/\.md$/, '')
      const raw = fs.readFileSync(path.join(POSTS_DIR, filename), 'utf-8')
      const { data } = matter(raw)
      return {
        slug,
        title: String(data.title || slug),
        date: stringifyDate(data.date),
        excerpt: String(data.excerpt || ''),
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        cover: String(data.cover || ''),
      }
    })

    return posts.sort((a, b) => (a.date < b.date ? 1 : -1))
  } catch {
    return []
  }
}

export function getPost(slug: string): Post | null {
  const filepath = path.join(POSTS_DIR, `${slug}.md`)
  try {
    if (!fs.existsSync(filepath)) return null
    const raw = fs.readFileSync(filepath, 'utf-8')
    const { data, content } = matter(raw)
    return {
      slug,
      title: String(data.title || slug),
      date: stringifyDate(data.date),
      excerpt: String(data.excerpt || ''),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      cover: String(data.cover || ''),
      content,
    }
  } catch {
    return null
  }
}
