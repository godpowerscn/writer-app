export interface Article {
  id: string;
  title: string;
  content: string;
  excerpt: string;
  status: 'draft' | 'published';
  category_id: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  category_name?: string;
  category_color?: string;
  tags?: Tag[];
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  color: string;
  created_at: string;
  article_count?: number;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  article_count?: number;
}

export interface CreateArticleInput {
  title?: string;
  content?: string;
  status?: 'draft' | 'published';
  category_id?: string | null;
  tag_ids?: string[];
}

export interface UpdateArticleInput {
  title?: string;
  content?: string;
  excerpt?: string;
  status?: 'draft' | 'published';
  category_id?: string | null;
  tag_ids?: string[];
}

export interface CreateCategoryInput {
  name: string;
  slug: string;
  description?: string;
  color?: string;
}

export interface CreateTagInput {
  name: string;
  slug: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
}
