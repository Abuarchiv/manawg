import activity from './activity';
import audit from './audit';
import auth from './auth';
import chat from './chat';
import chores from './chores';
import common from './common';
import entry from './entry';
import events from './events';
import expenses from './expenses';
import expensesAbos from './expenses-abos';
import expensesDebts from './expenses-debts';
import expensesForm from './expenses-form';
import expensesImport from './expenses-import';
import exportMessages from './export';
import home from './home';
import inventory from './inventory';
import mail from './mail';
import meta from './meta';
import offline from './offline';
import pinnwand from './pinnwand';
import push from './push';
import serverPages from './server-pages';
import settings from './settings';
import shell from './shell';
import shopping from './shopping';
import statement from './statement';

export default {
	common,
	meta,
	shell,
	home,
	activity,
	expenses,
	'expenses-form': expensesForm,
	'expenses-debts': expensesDebts,
	'expenses-import': expensesImport,
	'expenses-abos': expensesAbos,
	statement,
	chores,
	events,
	shopping,
	inventory,
	pinnwand,
	chat,
	settings,
	entry,
	auth,
	offline,
	push,
	mail,
	audit,
	export: exportMessages,
	'server-pages': serverPages,
} as const;
