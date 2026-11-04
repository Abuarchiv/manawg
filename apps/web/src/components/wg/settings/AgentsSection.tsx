'use client';

import { Copy, Unplug } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/Toast';
import { Section } from '@/components/wg/settings/Section';
import { useCachedFetch } from '@/core/hooks/use-cached-fetch';
import { apiFetch } from '@/core/infra/api-client';
import { copyText } from '@/core/utils/clipboard';
import { dateTimeFormat } from '@/shared/i18n/intl';
import type { Locale } from '@/shared/i18n/locale';

/** Public URL of the instance's MCP server; without it the instance offers no agent access. */
const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL?.trim() || null;

interface ConnectedAgent {
	clientId: string;
	name: string | null;
	grantedAt: string;
}

function grantedDate(grantedAt: string, locale: Locale): string {
	return dateTimeFormat(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'Europe/Berlin',
	}).format(new Date(grantedAt));
}

/** AI assistants: the MCP address to add in an agent, and the agents connected to this account. */
export function AgentsSection({ memberId }: { memberId: string }) {
	if (!MCP_URL) return null;
	return <ConnectedAgents mcpUrl={MCP_URL} memberId={memberId} />;
}

function ConnectedAgents({ mcpUrl, memberId }: { mcpUrl: string; memberId: string }) {
	const t = useTranslations('settings.agents');
	const locale = useLocale();
	const toast = useToast();
	const {
		data,
		error: loadError,
		refresh,
	} = useCachedFetch<{ agents: ConnectedAgent[] }>('/api/auth/agent-grants', { memberId });
	const [revokingId, setRevokingId] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const busyRef = useRef(false);

	async function copy(): Promise<void> {
		if (await copyText(mcpUrl)) toast.success(t('copied'));
		else toast.error(t('copyFailed'));
	}

	async function disconnect(agent: ConnectedAgent, name: string): Promise<void> {
		if (busyRef.current) return;
		busyRef.current = true;
		setRevokingId(agent.clientId);
		setError(null);
		setMessage(null);
		try {
			const res = await apiFetch<{ ok: true }>('/api/auth/agent-grants/revoke', {
				method: 'POST',
				body: JSON.stringify({ clientId: agent.clientId }),
			});
			if (!res.ok) {
				setError(t('disconnectFailed'));
				return;
			}
			setMessage(t('disconnected', { name }));
			void refresh({ afterMutation: true });
		} finally {
			busyRef.current = false;
			setRevokingId(null);
		}
	}

	const agents = data?.agents ?? [];

	return (
		<Section id="agents" title={t('title')} hint={t('hint')}>
			<div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-3">
				<div className="grid gap-2">
					<p className="text-muted-foreground text-xs">{t('addressLabel')}</p>
					<p className="text-foreground break-all font-mono text-sm">{mcpUrl}</p>
					<p className="text-muted-foreground text-xs">{t('howTo')}</p>
					<Button
						type="button"
						variant="outline"
						aria-label={t('copyAria')}
						onClick={() => void copy()}
						className="w-full"
					>
						<Copy aria-hidden />
						{t('copy')}
					</Button>
				</div>
				{message && (
					<Alert>
						<AlertDescription>{message}</AlertDescription>
					</Alert>
				)}
				{(error || loadError) && (
					<Alert variant="destructive">
						<AlertDescription>{error ?? t('loadFailed')}</AlertDescription>
					</Alert>
				)}
				{data && agents.length === 0 && (
					<p className="text-muted-foreground text-sm">{t('empty')}</p>
				)}
				{agents.length > 0 && (
					<ul className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-label={t('listLabel')}>
						{agents.map((agent) => {
							const name = agent.name ?? t('unnamed');
							return (
								<li
									key={agent.clientId}
									className="flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
								>
									<div className="min-w-0">
										<p className="text-foreground text-sm font-medium [overflow-wrap:break-word]">
											{name}
										</p>
										<p className="text-muted-foreground text-xs">
											{t('connectedAt', { date: grantedDate(agent.grantedAt, locale) })}
										</p>
									</div>
									<Button
										type="button"
										variant="outline"
										className="shrink-0"
										disabled={revokingId !== null}
										aria-label={t('disconnectAria', { name })}
										onClick={() => void disconnect(agent, name)}
									>
										{revokingId === agent.clientId ? (
											<Spinner aria-hidden />
										) : (
											<Unplug aria-hidden />
										)}
										{t('disconnect')}
									</Button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</Section>
	);
}
