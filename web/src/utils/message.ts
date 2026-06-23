import { ElNotification } from 'element-plus'
import { translate } from '@/lang/messages'

export const notifyError = (msg: string) => {
    ElNotification({
        title: translate('message_error_title'),
        message: msg,
        type: 'error',
        position: 'top-right',
        duration: 3000,
        dangerouslyUseHTMLString: true
    })
}

export const notifyInfo = (msg: string) => {
    ElNotification({
        title: translate('message_info_title'),
        message: msg,
        type: 'info',
        position: 'top-right',
        duration: 3000,
        dangerouslyUseHTMLString: true
    })
}

export const notifySuccess = (msg: string) => {
    ElNotification({
        title: translate('message_success_title'),
        message: msg,
        type: 'success',
        position: 'top-right',
        duration: 3000,
        dangerouslyUseHTMLString: true
    })
}
