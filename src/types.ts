export interface User {
  id: string;
  username: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface Article {
  id: string;
  title: string;
  content: string;
  excerpt: string;
  status: 'draft' | 'published';
  user_id: string;
  category_id: string | null;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  category_name?: string;
  category_color?: string;
  tags?: Tag[];
  folder_name?: string;
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

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  user_id: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  children?: Folder[];
  article_count?: number;
}

export interface CreateArticleInput {
  title?: string;
  content?: string;
  status?: 'draft' | 'published';
  category_id?: string | null;
  folder_id?: string | null;
  tag_ids?: string[];
}

export interface UpdateArticleInput {
  title?: string;
  content?: string;
  excerpt?: string;
  status?: 'draft' | 'published';
  category_id?: string | null;
  folder_id?: string | null;
  sort_order?: number;
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

export interface CreateFolderInput {
  name: string;
  parent_id?: string | null;
  sort_order?: number;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
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
  JWT_SECRET: string;
}

export type AppBindings = { Bindings: Env; Variables: { userId: string } };
