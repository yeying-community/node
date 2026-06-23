import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useSolutionStore = defineStore('solution', () => {
    const solutionList = ref<any>([])
    const test = ref(1)

    function getSolutionList(keyWord: any) {
        const list = [
            {
                code: '1',
                title: '滑块拼图方案',
                desc: '提供流畅、高质量的使用体验。用户只需轻滑拼图即可完成安全验证，支持触发式、嵌入式、弹窗式等前后端集成方式，既可私有化交付，也可使用云服务。',
                list: [
                    {
                        name: '云服务定制版本',
                        code: 's1',
                        price: '¥4800',
                        items: [
                            { name: '可用实例数', value: '5个' },
                            { name: '并发能力', value: '100 次/秒' },
                            { name: '验证量', value: '3500次/小时' },
                            { name: '底图标识', value: '无品牌标识' }
                        ]
                    },
                    {
                        name: '私有化定制版本',
                        code: 's2',
                        price: '¥9600',
                        items: [
                            { name: '可用实例数', value: '5个' },
                            { name: '并发能力', value: '100 次/秒' },
                            { name: '验证量', value: '3500次/小时' },
                            { name: '底图标识', value: '无品牌标识' },
                            { name: '夜莺品牌标识', value: '可选' }
                        ]
                    },
                    {
                        name: '私有化企业版本',
                        code: 's3',
                        price: '¥12800',
                        items: [
                            { name: '可用实例数', value: '10个' },
                            { name: '并发能力', value: '300 次/秒' },
                            { name: '验证量', value: '12000次/小时' },
                            { name: '底图标识', value: '支持自定义' },
                            { name: '夜莺品牌标识', value: '可移除' }
                        ]
                    }
                ]
            },
            {
                code: '2',
                title: '行为验证方案',
                desc: '适用于需要更高抗刷能力的业务场景，可结合滑块、点击、轨迹等交互策略输出风险判断，兼顾安全性与通过率。',
                list: [
                    {
                        name: '标准云服务版本',
                        code: 'b1',
                        price: '¥6800',
                        items: [
                            { name: '可用实例数', value: '5个' },
                            { name: '并发能力', value: '150 次/秒' },
                            { name: '验证量', value: '5000次/小时' },
                            { name: '策略模板', value: '标准内置' }
                        ]
                    },
                    {
                        name: '私有化增强版本',
                        code: 'b2',
                        price: '¥16800',
                        items: [
                            { name: '可用实例数', value: '不限' },
                            { name: '并发能力', value: '500 次/秒' },
                            { name: '验证量', value: '按部署规模扩展' },
                            { name: '策略模板', value: '支持定制' },
                            { name: '部署方式', value: '私有化交付' }
                        ]
                    }
                ]
            }
        ]
        if (keyWord) {
            solutionList.value = list.slice(0, 1)
        } else {
            solutionList.value = list
        }
        test.value = 2
    }

    return { solutionList, getSolutionList, test }
})
