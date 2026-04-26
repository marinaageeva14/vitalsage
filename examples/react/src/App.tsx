import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Home     from './pages/Home.tsx';
import About    from './pages/About.tsx';
import Products from './pages/Products.tsx';
import Gallery  from './pages/Gallery.tsx';
import Heavy    from './pages/Heavy.tsx';

export default function App() {
  return (
    <BrowserRouter>
      <nav className="nav">
        <NavLink to="/" className="nav-brand" end>VitalSage Demo</NavLink>
        <ul className="nav-links">
          <li><NavLink to="/"        end>Home</NavLink></li>
          <li><NavLink to="/about"      >About</NavLink></li>
          <li><NavLink to="/products"   >Products</NavLink></li>
          <li><NavLink to="/gallery"    >Gallery</NavLink></li>
          <li><NavLink to="/heavy"      >Heavy Page</NavLink></li>
        </ul>
      </nav>

      <Routes>
        <Route path="/"         element={<Home />} />
        <Route path="/about"    element={<About />} />
        <Route path="/products" element={<Products />} />
        <Route path="/gallery"  element={<Gallery />} />
        <Route path="/heavy"    element={<Heavy />} />
      </Routes>
    </BrowserRouter>
  );
}
