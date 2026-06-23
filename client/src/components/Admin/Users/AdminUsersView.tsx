import { useState, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { UserPlus, Trash2, Ban, CircleCheck, ShieldCheck, X, Loader2, Users } from 'lucide-react';
import { SystemRoles } from 'librechat-data-provider';
import { useToastContext } from '@librechat/client';
import type { TAdminUser, TCreateAdminUser } from 'librechat-data-provider';
import {
  useListAdminUsers,
  useCreateAdminUserMutation,
  useDeleteAdminUserMutation,
  useSetAdminUserDisabledMutation,
} from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';
import { cn } from '~/utils';

function errMessage(error: unknown, fallback: string): string {
  const e = error as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error || fallback;
}

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/50" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[100] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border-light bg-surface-primary p-5 shadow-xl outline-none">
          <div className="mb-4 flex items-center justify-between">
            <DialogPrimitive.Title className="text-base font-semibold text-text-primary">
              {title}
            </DialogPrimitive.Title>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-text-secondary hover:bg-surface-hover"
              aria-label="close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [form, setForm] = useState<TCreateAdminUser>({
    email: '',
    name: '',
    username: '',
    password: '',
    role: SystemRoles.USER,
  });
  const create = useCreateAdminUserMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_admin_user_created'), status: 'success' });
      onClose();
    },
    onError: (e) => showToast({ message: errMessage(e, localize('com_ui_error')), status: 'error' }),
  });

  const set = (k: keyof TCreateAdminUser) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const inputCls =
    'w-full rounded-lg border border-border-medium bg-surface-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-green-500';
  const valid = form.email.trim() && form.name.trim().length >= 3 && form.username.trim() && form.password;

  return (
    <Modal open onClose={onClose} title={localize('com_ui_admin_add_user')}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          {localize('com_auth_email_address')}
          <input className={inputCls} type="email" value={form.email} onChange={set('email')} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          {localize('com_auth_full_name')}（≥3）
          <input className={inputCls} value={form.name} onChange={set('name')} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          {localize('com_auth_username')}
          <input className={inputCls} value={form.username} onChange={set('username')} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          {localize('com_auth_password')}
          <input className={inputCls} type="text" value={form.password} onChange={set('password')} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          {localize('com_ui_admin_role')}
          <select className={inputCls} value={form.role} onChange={set('role')}>
            <option value={SystemRoles.USER}>USER</option>
            <option value={SystemRoles.ADMIN}>ADMIN</option>
          </select>
        </label>
        <button
          type="button"
          disabled={!valid || create.isLoading}
          onClick={() => create.mutate(form)}
          className={cn(
            'mt-1 flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white',
            !valid || create.isLoading
              ? 'cursor-not-allowed bg-surface-tertiary text-text-secondary'
              : 'bg-green-600 hover:bg-green-700',
          )}
        >
          {create.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {localize('com_ui_create')}
        </button>
      </div>
    </Modal>
  );
}

export default function AdminUsersView() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { showToast } = useToastContext();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TAdminUser | null>(null);

  const { data, isLoading } = useListAdminUsers({ enabled: user?.role === SystemRoles.ADMIN });
  const users = useMemo(() => data?.users ?? [], [data]);

  const setDisabled = useSetAdminUserDisabledMutation({
    onError: (e) => showToast({ message: errMessage(e, localize('com_ui_error')), status: 'error' }),
  });
  const remove = useDeleteAdminUserMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_admin_user_deleted'), status: 'success' });
      setDeleteTarget(null);
    },
    onError: (e) => showToast({ message: errMessage(e, localize('com_ui_error')), status: 'error' }),
  });

  const toggleDisabled = useCallback(
    (u: TAdminUser) => setDisabled.mutate({ id: u.id, disabled: !u.disabled }),
    [setDisabled],
  );

  if (user && user.role !== SystemRoles.ADMIN) {
    return <Navigate to="/c/new" replace />;
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-presentation">
      <div className="flex w-full flex-col gap-5 p-4 md:p-6 lg:p-8">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-600/10 text-green-600">
              <Users className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-text-primary">
                {localize('com_ui_admin_users')}
              </h1>
              <p className="text-sm text-text-secondary">
                {localize('com_ui_admin_users_desc')} · {users.length}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex h-10 items-center gap-2 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white hover:bg-green-700"
          >
            <UserPlus className="h-4 w-4" />
            {localize('com_ui_admin_add_user')}
          </button>
        </header>

        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-text-secondary">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border-light bg-surface-primary-alt">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-border-light text-text-secondary">
                <tr>
                  <th className="px-4 py-3 font-medium">{localize('com_auth_full_name')}</th>
                  <th className="px-4 py-3 font-medium">{localize('com_auth_email')}</th>
                  <th className="px-4 py-3 font-medium">{localize('com_auth_username')}</th>
                  <th className="px-4 py-3 font-medium">{localize('com_ui_admin_role')}</th>
                  <th className="px-4 py-3 font-medium">{localize('com_ui_admin_status')}</th>
                  <th className="px-4 py-3 text-right font-medium">{localize('com_ui_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === (user?.id ?? '');
                  return (
                    <tr key={u.id} className="border-b border-border-light last:border-0">
                      <td className="px-4 py-3 text-text-primary">{u.name}</td>
                      <td className="px-4 py-3 text-text-secondary">{u.email}</td>
                      <td className="px-4 py-3 text-text-secondary">{u.username}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                            u.role === SystemRoles.ADMIN
                              ? 'bg-green-600/10 text-green-700 dark:text-green-400'
                              : 'bg-surface-tertiary text-text-secondary',
                          )}
                        >
                          {u.role === SystemRoles.ADMIN && <ShieldCheck className="h-3 w-3" />}
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 text-xs',
                            u.disabled ? 'text-red-500' : 'text-green-600 dark:text-green-400',
                          )}
                        >
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              u.disabled ? 'bg-red-500' : 'bg-green-500',
                            )}
                          />
                          {u.disabled
                            ? localize('com_ui_admin_disabled')
                            : localize('com_ui_admin_active')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            disabled={isSelf || setDisabled.isLoading}
                            onClick={() => toggleDisabled(u)}
                            title={
                              u.disabled
                                ? localize('com_ui_admin_enable')
                                : localize('com_ui_admin_disable')
                            }
                            className={cn(
                              'rounded-lg p-2 transition-colors',
                              isSelf
                                ? 'cursor-not-allowed text-text-tertiary opacity-40'
                                : 'text-text-secondary hover:bg-surface-hover',
                            )}
                          >
                            {u.disabled ? (
                              <CircleCheck className="h-4 w-4" />
                            ) : (
                              <Ban className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={isSelf}
                            onClick={() => setDeleteTarget(u)}
                            title={localize('com_ui_delete')}
                            className={cn(
                              'rounded-lg p-2 transition-colors',
                              isSelf
                                ? 'cursor-not-allowed text-text-tertiary opacity-40'
                                : 'text-red-500 hover:bg-red-500/10',
                            )}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && <CreateUserDialog onClose={() => setShowCreate(false)} />}

      {deleteTarget && (
        <Modal
          open
          onClose={() => setDeleteTarget(null)}
          title={localize('com_ui_admin_delete_user')}
        >
          <p className="mb-4 text-sm text-text-secondary">
            {localize('com_ui_admin_delete_confirm', { name: deleteTarget.name || deleteTarget.email })}
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg border border-border-medium px-4 py-2 text-sm text-text-primary hover:bg-surface-hover"
            >
              {localize('com_ui_cancel')}
            </button>
            <button
              disabled={remove.isLoading}
              onClick={() => remove.mutate(deleteTarget.id)}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              {remove.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {localize('com_ui_delete')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
