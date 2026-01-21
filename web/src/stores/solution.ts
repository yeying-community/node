import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useSolutionStore = defineStore('solution', () => {
    const solutionList = ref<any>([])
    const test = ref(1)

    function getSolutionList(keyWord: any) {
        const list = [
            {
                code: '1',
                title: 'Sliding puzzle solution',
                desc: 'Smooth and high-quality user experience. You only need to slide the puzzle lightly to complete the security verification. It supports a variety of front-end and back-end integration solutions, including trigger, embedded, and pop-up. The delivery form can be private delivery or cloud service.',
                list: [
                    {
                        name: '云服务定制版本',
                        code: 's1',
                        price: '¥4800',
                        items: [
                            { name: '可用ID', value: '5个' },
                            { name: '并发量', value: '100Q/s' },
                            { name: '验证量', value: '3500次/小时' },
                            { name: '底图', value: '无Logo' }
                        ]
                    },
                    {
                        name: '私有化定制版本',
                        code: 's2',
                        price: '¥9600',
                        items: [
                            { name: '可用ID', value: '5个' },
                            { name: '并发量', value: '100Q/s' },
                            { name: '验证量', value: '3500次/小时' },
                            { name: '底图', value: '无Logo' },
                            { name: '包含夜莺logo', value: '' }
                        ]
                    },
                    {
                        name: '私有化定制版本',
                        code: 's2',
                        price: '¥9600',
                        items: [
                            { name: '可用ID', value: '5个' },
                            { name: '并发量', value: '100Q/s' },
                            { name: '验证量', value: '3500次/小时' },
                            { name: '底图', value: '无Logo' }
                        ]
                    }
                ]
            },
            {
                code: '2',
                title: '2Sliding puzzle solution',
                desc: '2Smooth and high-quality user experience. You only need to slide the puzzle lightly to complete the security verification. It supports a variety of front-end and back-end integration solutions, including trigger, embedded, and pop-up. The delivery form can be private delivery or cloud service.',
                list: [
                    {
                        name: '云服务定制版本',
                        code: 's1',
                        price: '¥4800',
                        items: [
                            { name: '可用ID', value: '5个' },
                            { name: '并发量', value: '100Q/s' },
                            { name: '验证量', value: '3500次/小时' },
                            { name: '底图', value: '无Logo' }
                        ]
                    },
                    {
                        name: '私有化定制版本',
                        code: 's2',
                        price: '¥9600',
                        items: [
                            { name: '可用ID', value: '5个' },
                            { name: '并发量', value: '100Q/s' },
                            { name: '验证量', value: '3500次/小时' },
                            { name: '底图', value: '无Logo' }
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
