import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TarotCard } from '../types';
import { cx } from '../utils';

const suitNames: Record<string, string> = {
  cups: '圣杯',
  pentacles: '星币',
  swords: '宝剑',
  wands: '权杖',
};

export function CardFace({ card, className, showName = true }: {
  card: TarotCard;
  className?: string;
  showName?: boolean;
}) {
  const localSource = `/cards/${encodeURIComponent(card.id)}.jpg`;
  const [source, setSource] = useState(localSource);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSource(localSource);
    setFailed(false);
  }, [localSource]);

  return (
    <div className={cx('tarot-card', className)} data-arcana={card.arcana}>
      <div className={cx('tarot-card__art', card.orientation === 'reversed' && 'is-reversed')}>
        {!failed ? (
          <img
            src={source}
            alt={`${card.name_zh}牌面`}
            loading="lazy"
            onError={() => {
              if (card.image_url && source !== card.image_url) setSource(card.image_url);
              else setFailed(true);
            }}
          />
        ) : (
          <div className="tarot-card__fallback" role="img" aria-label={`${card.name_zh}牌面暂缺`}>
            <span className="tarot-card__orbit" aria-hidden="true" />
            <Sparkles aria-hidden="true" />
            <strong>{card.name_zh}</strong>
            <small>{card.arcana === 'major' ? '大阿尔克那' : suitNames[card.suit ?? ''] ?? card.suit ?? '小阿尔克那'}</small>
          </div>
        )}
      </div>
      {showName && (
        <div className="tarot-card__caption">
          <strong>{card.name_zh}</strong>
          <span>{card.name_en}</span>
          <small>{card.orientation_zh}</small>
        </div>
      )}
    </div>
  );
}

export function CardBack({ className }: { className?: string }) {
  return (
    <div className={cx('tarot-card-back', className)} aria-label="星帷牌背">
      <span className="tarot-card-back__ring" aria-hidden="true" />
      <span className="tarot-card-back__moon" aria-hidden="true">☾</span>
      <small>ASTRAL VEIL</small>
    </div>
  );
}
