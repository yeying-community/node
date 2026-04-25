import { ElNotification } from 'element-plus'

export const notifyError = (msg: string) => {
    ElNotification({
        title: '错误',
        message: msg,
        type: 'error',
        position: 'top-right',
        duration: 3000,
        dangerouslyUseHTMLString: true
    })
}

export const notifyInfo = (msg: string) => {
    ElNotification({
        title: '消息',
        message: msg,
        type: 'info',
        position: 'top-right',
        duration: 3000,
        dangerouslyUseHTMLString: true
    })
}

export const notifySuccess = (msg: string) => {
    ElNotification({
        title: '成功',
        message: msg,
        type: 'success',
        position: 'top-right',
        duration: 3000,
        dangerouslyUseHTMLString: true
    })
}
