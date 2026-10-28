import { getAppUrl } from '@/shared/lib/app-url';
import { LoginClient } from './LoginClient';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
	return <LoginClient appOrigin={getAppUrl()} />;
}
