import { memo, useCallback, lazy, Suspense } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRecoilValue } from 'recoil';
import { SquarePen, Sparkles } from 'lucide-react';
import { QueryKeys } from 'librechat-data-provider';
import { Skeleton, Sidebar, Button, TooltipAnchor } from '@librechat/client';
import type { NavLink } from '~/common';
import { CLOSE_SIDEBAR_ID } from '~/components/Chat/Menus/OpenSidebar';
import { useActivePanel, resolveActivePanel, DEFAULT_PANEL } from '~/Providers';
import { useLocalize, useNewConvo } from '~/hooks';
import { clearMessagesCache, cn } from '~/utils';
import store from '~/store';

const AccountSettings = lazy(() => import('~/components/Nav/AccountSettings'));

const NewChatButton = memo(function NewChatButton({
  setActive,
  expanded,
}: {
  setActive: (id: string) => void;
  expanded: boolean;
}) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { newConversation } = useNewConvo();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const switchToHistory = useRecoilValue(store.newChatSwitchToHistory);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        clearMessagesCache(queryClient, conversation?.conversationId);
        queryClient.invalidateQueries([QueryKeys.messages]);
        newConversation();
        if (switchToHistory) {
          setActive(DEFAULT_PANEL);
        }
      }
    },
    [queryClient, conversation?.conversationId, newConversation, switchToHistory, setActive],
  );

  const label = localize('com_ui_new_chat');
  const content = (
    <a
      href="/c/new"
      data-testid="new-chat-button"
      aria-label={label}
      className={cn(
        'flex h-9 items-center rounded-lg transition-colors hover:bg-surface-hover',
        expanded ? 'w-full gap-2 px-2' : 'w-9 justify-center',
      )}
      onClick={handleClick}
    >
      <SquarePen className="h-5 w-5 flex-shrink-0 text-text-primary" />
      {expanded && <span className="truncate text-sm text-text-primary">{label}</span>}
    </a>
  );

  return expanded ? content : <TooltipAnchor side="right" description={label} render={content} />;
});

const DrawButton = memo(function DrawButton({ expanded }: { expanded: boolean }) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === '/draw';

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        navigate('/draw');
      }
    },
    [navigate],
  );

  const label = localize('com_ui_image_gen');
  const content = (
    <a
      href="/draw"
      data-testid="draw-button"
      aria-label={label}
      className={cn(
        'flex h-9 items-center rounded-lg transition-colors hover:bg-surface-hover',
        expanded ? 'w-full gap-2 px-2' : 'w-9 justify-center',
        isActive ? 'bg-surface-active-alt text-text-primary' : 'text-text-primary',
      )}
      onClick={handleClick}
    >
      <Sparkles className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
      {expanded && <span className="truncate text-sm">{label}</span>}
    </a>
  );

  return expanded ? content : <TooltipAnchor side="right" description={label} render={content} />;
});

const NavIconButton = memo(function NavIconButton({
  link,
  isActive,
  expanded,
  setActive,
  onExpand,
  onCollapse,
}: {
  link: NavLink;
  isActive: boolean;
  expanded: boolean;
  setActive: (id: string) => void;
  onExpand?: () => void;
  onCollapse?: () => void;
}) {
  const localize = useLocalize();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (link.onClick) {
        link.onClick(e);
        return;
      }
      if (isActive && expanded) {
        onCollapse?.();
        return;
      }
      if (!isActive) {
        setActive(link.id);
      }
      if (!expanded) {
        onExpand?.();
      }
    },
    [link, isActive, setActive, expanded, onExpand, onCollapse],
  );

  const label = localize(link.title);
  const content = (
    <Button
      variant="ghost"
      aria-label={label}
      aria-pressed={isActive}
      className={cn(
        'h-9 rounded-lg',
        expanded ? 'w-full justify-start gap-2 px-2' : 'w-9 justify-center p-0',
        isActive ? 'bg-surface-active-alt text-text-primary' : 'text-text-secondary',
      )}
      onClick={handleClick}
    >
      <link.icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
      {expanded && <span className="truncate text-sm">{label}</span>}
    </Button>
  );

  return expanded ? content : <TooltipAnchor description={label} side="right" render={content} />;
});

function ExpandedPanel({
  links,
  expanded = true,
  onCollapse,
  onExpand,
}: {
  links: NavLink[];
  expanded?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
}) {
  const localize = useLocalize();
  const { active, setActive } = useActivePanel();
  const effectiveActive = resolveActivePanel(active, links);

  const toggleLabel = expanded ? 'com_nav_close_sidebar' : 'com_nav_open_sidebar';
  const toggleClick = expanded ? onCollapse : onExpand;

  return (
    <div
      className={cn(
        'flex h-full flex-shrink-0 flex-col gap-2 border-r border-border-light bg-surface-primary-alt px-2 py-2 transition-[width] duration-200',
        expanded ? 'w-44' : 'w-[52px]',
      )}
    >
      <TooltipAnchor
        side="right"
        description={localize(toggleLabel)}
        render={
          <Button
            id={expanded ? CLOSE_SIDEBAR_ID : undefined}
            data-testid={expanded ? 'close-sidebar-button' : 'open-sidebar-button'}
            size="icon"
            variant="ghost"
            aria-label={localize(toggleLabel)}
            aria-expanded={expanded}
            className="h-9 w-9 rounded-lg"
            onClick={toggleClick}
          >
            <Sidebar aria-hidden="true" className="h-5 w-5 text-text-primary" />
          </Button>
        }
      />
      <NewChatButton setActive={setActive} expanded={expanded} />
      <DrawButton expanded={expanded} />
      <div className="mx-2 border-b border-border-light" />
      <div className="flex flex-col gap-1 overflow-y-auto">
        {links.map((link) => (
          <NavIconButton
            key={link.id}
            link={link}
            isActive={link.id === effectiveActive}
            expanded={expanded ?? true}
            setActive={setActive}
            onExpand={onExpand}
            onCollapse={onCollapse}
          />
        ))}
      </div>

      <div className="mt-auto">
        <Suspense fallback={<Skeleton className="h-9 w-9 rounded-lg" />}>
          <AccountSettings collapsed />
        </Suspense>
      </div>
    </div>
  );
}

export default memo(ExpandedPanel);
