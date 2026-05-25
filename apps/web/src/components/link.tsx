import NextLink, { type LinkProps as NextLinkProps } from 'next/link';
import type { ReactNode } from 'react';

interface Props extends NextLinkProps {
  children: ReactNode;
  className?: string;
}

export function Link({ children, className, ...rest }: Props) {
  return (
    <NextLink {...rest} className={className}>
      {children}
    </NextLink>
  );
}
