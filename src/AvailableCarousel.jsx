import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { priceLabel } from './components.jsx';

export default function AvailableCarousel({ items = [], loading = false, onOpen, t }) {
  const trackRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Filter and prioritize available items
  const availableItems = useMemo(() => {
    if (!items || items.length === 0) return [];
    return items
      .filter(it => it.k) // in stock
      .sort((a, b) => {
        // Items with images first
        if (a.img && !b.img) return -1;
        if (!a.img && b.img) return 1;
        // Items with wholesale price first
        if (a.p != null && b.p == null) return -1;
        if (a.p == null && b.p != null) return 1;
        // Higher stock on hand first
        return (b.stock || 0) - (a.stock || 0);
      })
      .slice(0, 18); // top 18 spotlight items
  }, [items]);

  const updateScrollState = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);

    // Calculate approximate active slide index
    if (clientWidth > 0) {
      const cardWidth = el.querySelector('.avail-card')?.offsetWidth || 260;
      const gap = 16;
      const index = Math.round(scrollLeft / (cardWidth + gap));
      setActiveIndex(Math.max(0, Math.min(index, availableItems.length - 1)));
    }
  }, [availableItems.length]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, [updateScrollState]);

  // Auto-play scroll
  useEffect(() => {
    if (isPaused || loading || availableItems.length <= 1) return;

    const interval = setInterval(() => {
      const el = trackRef.current;
      if (!el) return;
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const card = el.querySelector('.avail-card');
      const cardWidth = card ? card.offsetWidth + 16 : 280;

      if (scrollLeft + clientWidth >= scrollWidth - 15) {
        // Wrap back to beginning
        el.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        el.scrollBy({ left: cardWidth, behavior: 'smooth' });
      }
    }, 4500);

    return () => clearInterval(interval);
  }, [isPaused, loading, availableItems.length]);

  const scrollByCard = (direction) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.querySelector('.avail-card');
    const scrollAmount = card ? card.offsetWidth + 16 : 280;
    el.scrollBy({
      left: direction === 'next' ? scrollAmount * 1.5 : -scrollAmount * 1.5,
      behavior: 'smooth',
    });
  };

  const scrollToIndex = (index) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.querySelector('.avail-card');
    const cardWidth = card ? card.offsetWidth + 16 : 280;
    el.scrollTo({
      left: index * cardWidth,
      behavior: 'smooth',
    });
  };

  if (!loading && availableItems.length === 0) {
    return null;
  }

  return (
    <section
      className="avail-carousel-card"
      aria-label="Available Products Carousel"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
      onTouchEnd={() => setIsPaused(false)}
    >
      {/* Top Banner Header */}
      <div className="avail-carousel-header">
        <div className="avail-carousel-title-group">
          <div className="avail-badge">
            <span className="pulse-dot" />
            <span>{t.availableItemsTitle || 'Available Now'}</span>
          </div>
          <div>
            <h2 className="avail-heading">
              {t.featuredSpotlight || 'In-Stock Spotlight'}
            </h2>
            <p className="avail-subheading">
              {availableItems.length} {t.availableItemsSubtitle || 'items ready for immediate wholesale dispatch'}
            </p>
          </div>
        </div>

        {/* Carousel Arrow Controls */}
        <div className="avail-nav-buttons">
          <button
            type="button"
            className="avail-nav-btn btn-press"
            onClick={() => scrollByCard('prev')}
            disabled={!canScrollLeft}
            aria-label="Previous items"
            style={{ opacity: canScrollLeft ? 1 : 0.45 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            type="button"
            className="avail-nav-btn btn-press"
            onClick={() => scrollByCard('next')}
            disabled={!canScrollRight}
            aria-label="Next items"
            style={{ opacity: canScrollRight ? 1 : 0.45 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Horizontal Carousel Track */}
      <div className="avail-track-wrapper">
        <div
          ref={trackRef}
          className="avail-carousel-track"
          tabIndex={0}
          role="region"
          aria-label="Available products list"
        >
          {loading ? (
            // Skeleton loaders
            Array.from({ length: 4 }).map((_, idx) => (
              <div key={`skel-${idx}`} className="avail-card avail-card-skel">
                <div className="skel-shimmer skel-img" />
                <div className="avail-card-body">
                  <div className="skel-shimmer skel-line" style={{ width: '40%' }} />
                  <div className="skel-shimmer skel-line" style={{ width: '85%', height: 16 }} />
                  <div className="skel-shimmer skel-line" style={{ width: '60%', height: 14 }} />
                  <div className="skel-shimmer skel-line" style={{ width: '50%', marginTop: 'auto', height: 20 }} />
                </div>
              </div>
            ))
          ) : (
            availableItems.map((it) => {
              return (
                <div
                  key={it.id}
                  className="avail-card"
                  onClick={() => onOpen && onOpen(it)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen && onOpen(it);
                    }
                  }}
                >
                  {/* Image container */}
                  <div className="avail-card-img-wrap">
                    {it.img ? (
                      <img
                        src={it.img}
                        alt={it.n}
                        className="avail-card-img"
                        loading="lazy"
                      />
                    ) : (
                      <div className="avail-card-empty-img">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#C7BDAA" strokeWidth="1.5">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <path d="M21 15l-5-5L5 21" />
                        </svg>
                      </div>
                    )}

                    {/* Stock pill on top-left of image */}
                    <div className="avail-card-stock-pill">
                      <span className="pulse-dot-sm" />
                      <span>{t.inStock || 'In Stock'}</span>
                      {it.stock > 0 && <span className="avail-stock-count">({it.stock})</span>}
                    </div>

                    {/* Brand pill on top-right of image */}
                    {it.brand && (
                      <div className="avail-card-brand-pill">
                        {it.brand}
                      </div>
                    )}
                  </div>

                  {/* Card details */}
                  <div className="avail-card-body">
                    {it.barcode && (
                      <div className="avail-card-code">
                        {t.code || 'Code'}: {it.barcode}
                      </div>
                    )}

                    <div className="avail-card-name" title={it.n}>
                      {it.n}
                    </div>

                    <div className="avail-card-footer">
                      <div className="avail-card-price-block">
                        <span className="avail-price-label">{t.wholesalePrice || 'Wholesale'}</span>
                        <span
                          className="avail-price-value"
                          dir="ltr"
                          style={{ color: it.p == null ? '#DE3A1E' : 'var(--pri)' }}
                        >
                          {priceLabel(it, t)}
                        </span>
                      </div>

                      <button
                        type="button"
                        className="avail-inspect-btn"
                        title={t.viewItem || 'View Item'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen && onOpen(it);
                        }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Pagination Dots indicator */}
      {!loading && availableItems.length > 1 && (
        <div className="avail-dots-container">
          {Array.from({ length: Math.min(8, availableItems.length) }).map((_, dotIdx) => {
            const isCurrent = Math.min(activeIndex, 7) === dotIdx;
            return (
              <button
                key={`dot-${dotIdx}`}
                type="button"
                className={`avail-dot ${isCurrent ? 'active' : ''}`}
                onClick={() => scrollToIndex(dotIdx)}
                aria-label={`Go to slide ${dotIdx + 1}`}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
