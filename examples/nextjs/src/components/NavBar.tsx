'use client';

import Link     from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/',         label: 'Home'      },
  { href: '/about',    label: 'About'     },
  { href: '/products', label: 'Products'  },
  { href: '/gallery',  label: 'Gallery'   },
  { href: '/heavy',    label: 'Heavy Page'},
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      <Link href="/" className="nav-brand">VitalSage Demo</Link>
      <ul className="nav-links">
        {LINKS.map(({ href, label }) => (
          <li key={href}>
            <Link href={href} className={pathname === href ? 'active' : ''}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
