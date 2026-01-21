<template>
    <div class="slider-container" :style="{ width: w + 'px' }">
      <div class="slider-canvas" :style="{ width: w + 'px', height: h + 'px',display:open?'block':'none' }">
        <!-- 大图 -->
        <canvas :width="w" :height="h" ref="canvas" />
        <!-- 小图 -->
        <canvas
          class="slider-block"
          :width="sw"
          :height="sh"
          :style="{top:st+'px'}"
          ref="block"
        />
        <!-- 结果遮罩层 -->
        <div
          :class="`result-mask ${resultMask.class}`"
        >{{resultMask.msg}}</div>
      </div>
      <!-- 拖动的滑块内容 -->
      <div class="slider-square">
        <div class="box">
          <div
            class="slider-square-icon"
            @mouseenter="showImg"
            @mouseleave="hideImg"
            @mousedown="sliderDown"
            @touchstart="sliderDown"
            :style="{ left: slideInfo.sliderLeft }"
          ></div>
          <span class="text">{{ slideInfo.sliderText }}</span>
        </div>
      </div>
    </div>
  </template>
  
<script>
  import { ref, onMounted, reactive, onDeactivated, watch } from "vue";
  
  export default {
    props: {
      w: {
        // 大图的宽度
        type: Number,
        default: 200,
      },
      h: {
        // 大图的高度
        type: Number,
        default: 120,
      },
      l: {
        // 小图的宽度/高度(正方形的宽度,实际宽度需要加上圆弧的宽度)
        type: Number,
        default: 42,
      },
      sw: {
        // 小图的宽度
        type: Number,
        default: 28,
      },
      sh: {
        // 小图的高度
        type: Number,
        default: 38,
      },
      st: {
        // 小图的高度
        type: Number,
        default: 10,
      },
      sliderText: {
        // 滑块文字
        type: String,
        default: "向右拖动滑块填充拼图",
      },
      bigImg: {
        // 大图源
        type: String,
        default: "",
      },
      smImg: {
        // 小图图源
        type: String,
        default: "",
      },
      okMsg: {
        // 小图图源
        type: String,
        default: "验证成功",
      },
      failMsg: {
        // 小图图源
        type: String,
        default: "验证失败",
      },
      accuracy: {
        // 拖动误差范围
        type: Number,
        default: 5,
      },
    },
    setup(props, { emit }) {
      const canvas = ref(null); // 大图ref
      const canvasCtx = ref(null); // 大图canvas绘制容器
      const block = ref(null); // 小图ref
      const blockCtx = ref(null); // 小图canvas绘制容器
      const open = ref(false)
      const { w, h, l, r,sw,sh, sliderText } = props;
      const slideInfo = reactive({
        sliderLeft: 0, // 可拖动滑块的left
        block_x: 0, // 拼图最终要滑动的位置x
        block_y: 0, // 拼图位置的y
        sliderText, // 滑块提示文字
        bigImg: "",
        smImg: "",
      });
      const origin = reactive({
        // 鼠标按下初始位置
        orginX: 0,
        originY: 0,
      });
      const resultMask = reactive({
        // 结果提示背景色
        class: "",
        msg: "",
      });
  
      // 初始化canvas dom
      const initDom = () => {
        canvasCtx.value = canvas.value.getContext("2d");
        blockCtx.value = block.value.getContext("2d");
      };
      // 初始化图片
      const initImg = () => {
        const bigImg = createImg(() => {
          canvasCtx.value.drawImage(bigImg, 0, 0, w, h);
        }, props.bigImg);
        const smImg = createImg(() => {
          blockCtx.value.drawImage(smImg, 0, 0, sw, sh);
        }, props.smImg);
        slideInfo.bigImg = bigImg;
        slideInfo.smImg = smImg;
      };
  
      const createImg = (onload, url) => {
        const img = document.createElement("img");
        img.crossOrigin = "Anonymous";
        img.onload = onload;
        img.onerror = () => {
          img.src = url;
        };
        img.src = url;
        return img;
      };
  
      onMounted(() => {
        initDom();
        initImg();
        bindEvents();
      });
  
      const slider = ref(false);
  
      // 鼠标按下
      const sliderDown = (e) => {
        e.preventDefault();
        
        slider.value = true;
        // slideInfo.sliderText = "";
        const x = e.clientX || e.touches[0].clientX
        const y = e.clientY || e.touches[0].clientY
        origin.orginX = x;
        origin.originY = y;
        console.log('down',x,y)
      };
  
      // 鼠标移动
      const sliderMove = (e) => {
        e.preventDefault();
        if (slider.value) {
          const x = e.clientX || e.touches[0].clientX
          const y = e.clientY || e.touches[0].clientY
          const moveX = x - origin.orginX;
          const moveY = y - origin.originY;
          if (moveX < 0 || moveY + 38 > w) return false;
          slideInfo.sliderLeft = moveX + "px";
          block.value.style.left = moveX + "px";
        }
      };
  
      // 鼠标松开
      const sliderUp = (e) => {
        if (!slider.value) return false;
        slider.value = false;
        const left = parseInt(block.value.style.left);
        emit("sliderJudge", left);
      };
  
      // 将鼠标移动,鼠标松开事件绑定在dom上,如果鼠标移出滑块范围,还可以继续移动
      const bindEvents = () => {
        document.addEventListener("mousemove", sliderMove);
        document.addEventListener("mouseup", sliderUp);
        document.addEventListener("touchmove", sliderMove);
        document.addEventListener("touchend", sliderUp);
      };
  
      // 调用接口获取图片,异步,监听图片地址变动
      watch(
        () => props.bigImg,
        (newVal) => {
          slideInfo.bigImg.src = newVal;
        }
      );
      watch(
        () => props.smImg,
        (newVal) => {
          slideInfo.smImg.src = newVal;
        }
      );
      const onOk = () => {
        resultMask.class = "success"
        resultMask.msg = props.okMsg
        setTimeout(()=>{
          reset()
        },300)
      }
      const onFail = () => {
        resultMask.class = "fail"
        resultMask.msg = props.failMsg
        setTimeout(()=>{
          reset()
        },300)
      }
      // 重置/刷新图片
      const reset = () => {
        // canvasCtx.value.clearRect(0, 0, w, h);
        // blockCtx.value.clearRect(0, 0, w, h);
        slideInfo.sliderText = sliderText;
        // resultMask.height = 0;
        // resultMask.class = "";
        slideInfo.sliderLeft = 0;
        resultMask.class = "";
        resultMask.msg = "";
        block.value.style.left = 0;
      };
  
      // 组建销毁时,移除鼠标事件
      onDeactivated(() => {
        document.removeEventListener("mousemove", sliderMove);
        document.removeEventListener("mouseup", sliderUp);
        document.removeEventListener("touchmove", sliderMove);
        document.removeEventListener("touchend", sliderUp);
      });
      const showImg = () => {
        open.value = true
      }
      const hideImg = () => {
        open.value = false
      }
      return {
        canvas,
        canvasCtx,
        blockCtx,
        block,
        slideInfo,
        sliderDown,
        sliderMove,
        sliderUp,
        resultMask,
        reset,
        onOk,
        onFail,
        open,
        showImg,
        hideImg
      };
    },
  };
  </script>
  
<style>
  .slider-block {
    position: absolute;
    left: 0;
    top: 0;
  }
  .success {
    background-color: green;
  }
  .fail {
    background-color: red;
  }
  .result-mask {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 100%;
    opacity: 0.7;
    color:white;
    text-align: center;
    
  }
  .slider-canvas {
    position: absolute;
    bottom:42px;
  }
  .slider-container {
    position: relative;
  }
  .slider-square-icon:hover {
    background-color: #0098ff;
  }
  .slider-square-icon {
    position: absolute;
    top: 0;
    left: 0;
    height: 39px;
    width: 39px;
    background-color: #fff;
    box-shadow: #ddd 0px 0px 1px 2px;
    cursor: pointer;
  }
  .slider-square {
    background-color: #f7f9fa;
    height: 40px;
    text-align: center;
    line-height: 40px;
    border: 1px solid #ddd;
    position: relative;
    margin-top: 12px;
    color:rgba(0,0,0,0.6)
  }
  
  </style>
  