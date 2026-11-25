import { SITE_NAME } from '@suanomics/shared'

export function pageTitle(page?: string): string {
  return page ? `${page}｜${SITE_NAME}` : SITE_NAME
}
