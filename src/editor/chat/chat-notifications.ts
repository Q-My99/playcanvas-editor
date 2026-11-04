import { config } from '@/editor/config';

editor.once('load', () => {
    const panel = editor.call('chat:panel');
    let number = 0;
    let sceneName = '';

    const formatTitle = (unread = 0) => {
        const projectName = config.project?.name || 'PlayCanvas';
        const base = sceneName
            ? `${projectName} / ${sceneName} · Editor`
            : `${projectName} · Editor`;
        return unread > 0 ? `(${unread}) ${base}` : base;
    };

    const syncTitle = () => {
        const visible = editor.call('visibility');
        editor.call('notify:title', formatTitle(visible ? 0 : number));
    };

    editor.on('scene:name', (name: string) => {
        sceneName = name || '';
        syncTitle();
    });

    editor.on('scene:unload', () => {
        sceneName = '';
        syncTitle();
    });

    editor.on('visibility', (state: boolean) => {
        if (state) {
            number = 0;
            editor.call('notify:title', formatTitle(0));
        } else {
            number = editor.call('chat:unreadCount');
            if (number) {
                editor.call('notify:title', formatTitle(number));
            }
        }
    });

    editor.on('chat:post', (type: string | number, msg: string, element: HTMLElement) => {
        editor.call('notify:permission');

        const granted = editor.call('localStorage:get', 'editor:notifications:chat');
        const visible = editor.call('visibility');

        if (!visible) {
            number++;
            editor.call('notify:title', formatTitle(number));
        }

        if (visible || granted === false) {
            return;
        }

        let title;
        let icon;
        if (msg.length > 64) {
            msg = `${msg.slice(0, 64)}...`;
        }

        if (type === 'system') {
            title = 'System Message';
        } else if (typeof type === 'number') {
            const user = editor.call('users:get', type);
            title = `Message from ${(user && `@${user.username}`) || 'a user'}`;
            icon = `/api/users/${user.id}/thumbnail?size=128`;
        }

        editor.call('notify', {
            title: title,
            body: msg,
            icon: icon,
            click: function () {
                window.focus();
                panel.collapsed = false;
            }
        });
    });
});
