import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Loader2, Building2, AlertTriangle, AlertCircle } from 'lucide-react';
import type { Tenant } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  useTenantsQuery,
  useCreateTenantMutation,
  useUpdateTenantMutation,
  useDeleteTenantMutation,
} from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useToast } from '../hooks/useToast';
import './Tenants.css';

const NAME_MAX = 100;
const EXTERNAL_ID_MAX = 190;

const emptyForm = { name: '', externalId: '' };

interface EditDraft {
  name: string;
  externalId: string;
  isActive: boolean;
}

export function Tenants() {
  const { t } = useTranslation();
  const toast = useToast();
  useDocumentTitle(t('tenants.title'));
  const { data: tenants = [], isLoading: loading, error: tenantsError } = useTenantsQuery();
  const createMutation = useCreateTenantMutation();
  const updateMutation = useUpdateTenantMutation();
  const deleteMutation = useDeleteTenantMutation();

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Tenant | null>(null);

  const nameLength = [...form.name.trim()].length;
  const nameTooShort = nameLength < 1;
  const nameTooLong = [...form.name].length > NAME_MAX;
  const extTooLong = [...form.externalId].length > EXTERNAL_ID_MAX;
  const canCreate = !createMutation.isPending && !nameTooShort && !nameTooLong && !extTooLong;

  const closeCreate = () => {
    setShowCreate(false);
    setForm(emptyForm);
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    try {
      await createMutation.mutateAsync({
        name: form.name.trim(),
        ...(form.externalId.trim() ? { externalId: form.externalId.trim() } : {}),
      });
      closeCreate();
    } catch (err) {
      toast.error(t('tenants.createBtn'), err instanceof Error ? err.message : t('common.unknownError'));
    }
  };

  const openEdit = (tenant: Tenant) => {
    setEditing(tenant);
    setEditDraft({ name: tenant.name, externalId: tenant.externalId ?? '', isActive: tenant.isActive });
  };

  const closeEdit = () => {
    setEditing(null);
    setEditDraft(null);
  };

  const editNameLength = editDraft ? [...editDraft.name.trim()].length : 0;
  const canSave =
    !!editDraft &&
    !updateMutation.isPending &&
    editNameLength >= 1 &&
    [...editDraft.name].length <= NAME_MAX &&
    [...editDraft.externalId].length <= EXTERNAL_ID_MAX;

  const handleSave = async () => {
    if (!editing || !editDraft || !canSave) return;
    try {
      await updateMutation.mutateAsync({
        id: editing.id,
        data: {
          name: editDraft.name.trim(),
          // An empty field clears the external id (null); a value sets it.
          externalId: editDraft.externalId.trim() || null,
          isActive: editDraft.isActive,
        },
      });
      closeEdit();
    } catch (err) {
      toast.error(t('tenants.editTitle'), err instanceof Error ? err.message : t('common.unknownError'));
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteMutation.mutateAsync(target.id);
    } catch (err) {
      // The gateway refuses (409) while any key or session still references the tenant.
      const status = (err as { status?: number }).status;
      toast.error(
        t('tenants.actions.delete'),
        status === 409 ? t('tenants.deleteBlocked') : err instanceof Error ? err.message : t('common.unknownError'),
      );
    }
  };

  if (loading) {
    return (
      <div
        className="tenants-page"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}
      >
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  const forbidden = tenantsError && tenants.length === 0 && (tenantsError as { status?: number }).status === 403;

  return (
    <div className="tenants-page">
      <PageHeader
        title={t('tenants.title')}
        subtitle={t('tenants.subtitle')}
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={18} />
            {t('tenants.createBtn')}
          </button>
        }
      />

      {tenantsError && tenants.length > 0 && (
        <div className="error-banner" role="alert">
          <AlertCircle size={20} />
          <span className="error-banner-text">{t('dashboard.loadError')}</span>
        </div>
      )}

      <div className="tenants-table-container">
        {forbidden ? (
          <div className="empty-table-state" role="alert">
            <AlertCircle size={48} strokeWidth={1} />
            <h3>{t('tenants.empty.forbiddenTitle')}</h3>
            <p>{t('tenants.empty.forbiddenDesc')}</p>
          </div>
        ) : tenantsError && tenants.length === 0 ? (
          <div className="empty-table-state" role="alert">
            <AlertCircle size={48} strokeWidth={1} />
            <h3>{t('tenants.empty.loadErrorTitle')}</h3>
            <p>{(tenantsError as Error).message}</p>
          </div>
        ) : tenants.length === 0 ? (
          <div className="empty-table-state">
            <Building2 size={48} strokeWidth={1} />
            <h3>{t('tenants.empty.title')}</h3>
            <p>{t('tenants.empty.description')}</p>
          </div>
        ) : (
          <table className="tenants-table">
            <thead>
              <tr className="table-row header">
                <th>{t('tenants.columns.name')}</th>
                <th>{t('tenants.columns.externalId')}</th>
                <th>{t('tenants.columns.status')}</th>
                <th>{t('tenants.columns.created')}</th>
                <th>{t('tenants.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map(tenant => (
                <tr key={tenant.id} className="table-row">
                  <td>
                    <span className="name-cell">{tenant.name}</span>
                  </td>
                  <td>
                    {tenant.externalId ? (
                      <code className="external-id-cell">{tenant.externalId}</code>
                    ) : (
                      <span className="muted-cell">{t('tenants.none')}</span>
                    )}
                  </td>
                  <td>
                    <span className={`status-badge ${tenant.isActive ? 'active' : 'inactive'}`}>
                      {t(`tenants.statuses.${tenant.isActive ? 'active' : 'inactive'}`)}
                    </span>
                  </td>
                  <td>
                    <span className="muted-cell">
                      {tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : t('tenants.none')}
                    </span>
                  </td>
                  <td>
                    <span className="actions-cell">
                      <button className="icon-btn" onClick={() => openEdit(tenant)} title={t('tenants.actions.edit')}>
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-btn danger"
                        onClick={() => setConfirmDelete(tenant)}
                        title={t('tenants.actions.delete')}
                      >
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <Modal
          open
          onClose={createMutation.isPending ? () => {} : closeCreate}
          title={t('tenants.modalTitle')}
          closeLabel={t('common.close')}
          footer={
            <>
              <button className="btn-secondary" onClick={closeCreate} disabled={createMutation.isPending}>
                {t('common.cancel')}
              </button>
              <button className="btn-primary" onClick={() => void handleCreate()} disabled={!canCreate}>
                {createMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : t('common.create')}
              </button>
            </>
          }
        >
          <label htmlFor="tn-name">{t('tenants.nameLabel')}</label>
          <input
            id="tn-name"
            type="text"
            placeholder={t('tenants.namePlaceholder')}
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
          />
          <span className={nameTooLong ? 'key-field-hint error' : undefined} role="status">
            {nameTooLong ? t('common.fieldTooLong', { max: NAME_MAX, count: [...form.name].length }) : ''}
          </span>
          <label htmlFor="tn-ext">{t('tenants.externalIdLabel')}</label>
          <input
            id="tn-ext"
            type="text"
            spellCheck={false}
            placeholder={t('tenants.externalIdPlaceholder')}
            value={form.externalId}
            aria-describedby="tn-ext-hint"
            onChange={e => setForm({ ...form, externalId: e.target.value })}
          />
          {extTooLong && (
            <span className="key-field-hint error" role="alert">
              {t('common.fieldTooLong', { max: EXTERNAL_ID_MAX, count: [...form.externalId].length })}
            </span>
          )}
          <span id="tn-ext-hint" className="key-field-hint">
            {t('tenants.externalIdHint')}
          </span>
        </Modal>
      )}

      {editing && editDraft && (
        <Modal
          open
          onClose={updateMutation.isPending ? () => {} : closeEdit}
          title={t('tenants.editTitle')}
          closeLabel={t('common.close')}
          footer={
            <>
              <button className="btn-secondary" onClick={closeEdit} disabled={updateMutation.isPending}>
                {t('common.cancel')}
              </button>
              <button className="btn-primary" onClick={() => void handleSave()} disabled={!canSave}>
                {updateMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : t('common.save')}
              </button>
            </>
          }
        >
          <label htmlFor="tn-edit-name">{t('tenants.nameLabel')}</label>
          <input
            id="tn-edit-name"
            type="text"
            value={editDraft.name}
            disabled={updateMutation.isPending}
            onChange={e => setEditDraft({ ...editDraft, name: e.target.value })}
          />
          <label htmlFor="tn-edit-ext">{t('tenants.externalIdLabel')}</label>
          <input
            id="tn-edit-ext"
            type="text"
            spellCheck={false}
            value={editDraft.externalId}
            disabled={updateMutation.isPending}
            aria-describedby="tn-edit-ext-hint"
            onChange={e => setEditDraft({ ...editDraft, externalId: e.target.value })}
          />
          <span id="tn-edit-ext-hint" className="key-field-hint">
            {t('tenants.externalIdHint')}
          </span>
          <label className="tenants-check">
            <input
              type="checkbox"
              checked={editDraft.isActive}
              disabled={updateMutation.isPending}
              onChange={e => setEditDraft({ ...editDraft, isActive: e.target.checked })}
            />
            <span>{t('tenants.activeLabel')}</span>
          </label>
          <span className="key-field-hint">{t('tenants.activeHint')}</span>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          open
          onClose={() => setConfirmDelete(null)}
          title={t('tenants.confirm.deleteTitle')}
          className="confirm-modal"
          closeLabel={t('common.close')}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn-danger" onClick={() => void handleDelete()}>
                {t('tenants.confirm.delete')}
              </button>
            </>
          }
        >
          <div className="confirm-icon-wrapper">
            <AlertTriangle size={48} className="confirm-warning-icon" />
          </div>
          <p className="confirm-message">
            <Trans
              i18nKey="tenants.confirm.deleteMessage"
              components={{ name: <strong>{confirmDelete.name}</strong> }}
            />
          </p>
        </Modal>
      )}
    </div>
  );
}
