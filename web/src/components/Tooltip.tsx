import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ActiveTooltip {
  anchor: HTMLElement;
  text: string;
}

export function TooltipLayer() {
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const dismissRef = useRef<() => void>(() => {});

  useEffect(() => {
    let target: HTMLElement | null = null;
    let timer: number | undefined;
    const findAnchor = (node: EventTarget | null) => node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null;
    const hide = () => {
      window.clearTimeout(timer);
      target = null;
      setActive(null);
    };
    dismissRef.current = hide;
    const show = (anchor: HTMLElement | null) => {
      if (anchor === target) return;
      hide();
      if (!anchor?.dataset.tooltip?.trim() || anchor.closest('[inert]')) return;
      target = anchor;
      timer = window.setTimeout(() => {
        if (anchor.isConnected && !anchor.closest('[inert]')) {
          setActive({ anchor, text: anchor.dataset.tooltip! });
        } else hide();
      }, 250);
    };
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const anchor = findAnchor(event.target);
      if (anchor !== findAnchor(event.relatedTarget)) show(anchor);
    };
    const onPointerOut = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (findAnchor(event.target) === target && findAnchor(event.relatedTarget) !== target) hide();
    };
    const onPointerDown = (event: PointerEvent) => {
      const anchor = findAnchor(event.target);
      const openTouchHint = event.pointerType === 'touch' && anchor?.hasAttribute('data-tooltip-touch') && anchor !== target;
      hide();
      if (openTouchHint) show(anchor);
    };
    const onScroll = (event: Event) => {
      if (target && event.target instanceof Node && event.target.contains(target)) hide();
    };
    const onFocus = (event: FocusEvent) => {
      const anchor = findAnchor(event.target);
      if (anchor?.matches(':focus-visible')) show(anchor);
    };
    const onBlur = (event: FocusEvent) => {
      if (findAnchor(event.target) === target) hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (tooltipRef.current) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        hide();
      } else if (event.key === 'Enter' || event.key === ' ') hide();
    };
    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointercancel', hide, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', onBlur, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    window.visualViewport?.addEventListener('resize', hide);
    window.visualViewport?.addEventListener('scroll', hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointercancel', hide, true);
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', onBlur, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
      window.visualViewport?.removeEventListener('resize', hide);
      window.visualViewport?.removeEventListener('scroll', hide);
    };
  }, []);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!active || !tooltip) return;
    const { anchor } = active;
    const descriptions = anchor.getAttribute('aria-describedby');
    anchor.setAttribute('aria-describedby', [descriptions, id].filter(Boolean).join(' '));
    let frame = 0;
    const place = () => {
      if (!anchor.isConnected || anchor.closest('[inert]') || !anchor.getClientRects().length) {
        dismissRef.current();
        return;
      }
      const viewport = window.visualViewport;
      const text = anchor.dataset.tooltip?.trim();
      if (!text) {
        dismissRef.current();
        return;
      }
      if (text !== active.text) {
        setActive({ anchor, text });
        return;
      }
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + (viewport?.width ?? document.documentElement.clientWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16;
      tooltip.style.maxWidth = `${Math.max(0, Math.min(280, rightEdge - leftEdge))}px`;
      tooltip.style.maxHeight = `${Math.max(0, bottomEdge - topEdge)}px`;
      const anchorRect = anchor.getBoundingClientRect();
      const rect = tooltip.getBoundingClientRect();
      const above = anchorRect.top - topEdge - 8;
      const below = bottomEdge - anchorRect.bottom - 8;
      const top = above >= rect.height || above > below ? anchorRect.top - rect.height - 8 : anchorRect.bottom + 8;
      const left = anchorRect.left + (anchorRect.width - rect.width) / 2;
      tooltip.style.left = `${Math.max(leftEdge, Math.min(left, rightEdge - rect.width))}px`;
      tooltip.style.top = `${Math.max(topEdge, Math.min(top, bottomEdge - rect.height))}px`;
      tooltip.style.visibility = 'visible';
      frame = window.requestAnimationFrame(place);
    };
    place();
    return () => {
      window.cancelAnimationFrame(frame);
      const remaining = (anchor.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((value) => value && value !== id);
      if (remaining.length) anchor.setAttribute('aria-describedby', remaining.join(' '));
      else anchor.removeAttribute('aria-describedby');
    };
  }, [active, id]);

  return createPortal(
    <div className="tooltip-layer" data-tooltip-layer="">
      {active && <div ref={tooltipRef} id={id} role="tooltip" className="tooltip-bubble" style={{ visibility: 'hidden' }}>{active.text}</div>}
    </div>,
    document.body,
  );
}
