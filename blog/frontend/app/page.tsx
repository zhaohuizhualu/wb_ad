import Link from 'next/link'
import { getAllPosts } from '@/lib/posts'

export const dynamic = 'force-dynamic'

export default function BlogHome() {
  const posts = getAllPosts()

  return (
    <main className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <h1 className="text-2xl font-bold">我的博客</h1>
          <p className="mt-1 text-sm text-gray-500">工作记录与技术笔记</p>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        {posts.length === 0 ? (
          <div className="py-20 text-center text-gray-400">
            <p className="text-lg">还没有文章</p>
            <p className="mt-2 text-sm">
              将 Markdown 文件放到 <code className="rounded bg-gray-100 px-2 py-0.5">/root/blog/content/posts/</code> 目录即可
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {posts.map((post) => (
              <article key={post.slug} className="rounded-lg border border-gray-100 bg-white p-6 shadow-sm transition hover:shadow-md">
                <Link href={`/post/${post.slug}`}>
                  <h2 className="text-xl font-bold hover:text-blue-600">{post.title}</h2>
                </Link>
                {post.date && (
                  <time className="mt-1 block text-sm text-gray-500">{post.date}</time>
                )}
                {post.excerpt && (
                  <p className="mt-2 text-gray-600 line-clamp-3">{post.excerpt}</p>
                )}
                {post.tags && post.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {post.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
