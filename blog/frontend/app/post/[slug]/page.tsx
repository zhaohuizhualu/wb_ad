import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeHighlight from 'rehype-highlight'
import { getPost } from '@/lib/posts'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function PostPage({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug)
  if (!post) notFound()

  return (
    <main className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← 返回列表
          </Link>
          <h1 className="mt-3 text-2xl font-bold">{post.title}</h1>
          {post.date && (
            <time className="mt-1 block text-sm text-gray-500">{post.date}</time>
          )}
          {post.tags && post.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-8">
        <div className="prose-blog">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, rehypeHighlight]}
          >
            {post.content}
          </ReactMarkdown>
        </div>
      </article>
    </main>
  )
}
